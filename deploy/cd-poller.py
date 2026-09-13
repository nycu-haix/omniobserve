#!/usr/bin/env python3
"""Pull-based Dokploy CD for hosts that cannot receive GitHub webhooks."""
import argparse
import datetime
import re
import json
import os
import pathlib
import subprocess
import time
import urllib.parse
import urllib.request


def api(config, method, data=None):
    url = config['api_url'] + '/' + method
    headers = {'x-api-key': config['api_key'], 'Content-Type': 'application/json'}
    if method.endswith('.one'):
        url += '?' + urllib.parse.urlencode(data or {})
        body = None
    else:
        body = json.dumps(data or {}).encode()
    with urllib.request.urlopen(urllib.request.Request(url, data=body, headers=headers), timeout=30) as response:
        return json.load(response)


def save(path, state):
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(state, indent=2))
    temp.chmod(0o600)
    os.replace(temp, path)


def log(message):
    print(time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), message, flush=True)


def healthy(target):
    checks = target.get('health_checks') or [(target['frontend'], '/'), (target['backend'], '/health')]
    for host, path in checks:
        result = subprocess.run(['curl', '--fail', '--silent', '--show-error', '--max-time', '15', '--resolve', host + ':443:127.0.0.1', 'https://' + host + path], capture_output=True)
        if result.returncode:
            return False
    return True


def tick(config, state, state_path):
    targets = config['targets']
    refs = subprocess.check_output(['git', 'ls-remote', config['repository']] + ['refs/heads/' + t['branch'] for t in targets], timeout=45, env={**os.environ, 'GIT_TERMINAL_PROMPT': '0'}).decode()
    remote = {ref.removeprefix('refs/heads/'): sha for sha, ref in (line.split() for line in refs.splitlines())}
    statuses = {t.get('id', t['branch']): api(config, 'compose.one', {'composeId': t['compose_id']}) for t in targets}
    active = False
    now = time.time()
    for target in targets:
        branch = target['branch']
        target_id = target.get('id', branch)
        info = statuses[target_id]
        entry = state.setdefault(target_id, {'deployed': target['initial_commit']})
        pending = entry.get('pending')
        if pending:
            deployments = sorted(info.get('deployments') or [], key=lambda d: d.get('createdAt', ''), reverse=True)
            deployment = next((d for d in deployments if d.get('title') == pending['title'] or pending['sha'] in (d.get('description') or '') or (d.get('createdAt') and datetime.datetime.fromisoformat(d['createdAt'].replace('Z', '+00:00')).timestamp() >= pending['queued_at'])), None)
            if deployment and deployment.get('status') == 'done':
                if healthy(target):
                    actual = re.search(r'Commit: ([0-9a-f]{40})', deployment.get('description') or '')
                    entry['deployed'] = actual.group(1) if actual else pending['sha']
                    entry.pop('pending')
                    entry.pop('failure', None)
                    log('deployed ' + target_id + ' ' + pending['sha'])
                elif now - pending['queued_at'] > 900:
                    entry['failure'] = {'sha': pending['sha'], 'at': now, 'attempts': pending['attempts']}
                    entry.pop('pending')
                    log('health check failed ' + branch + ' ' + pending['sha'])
                else:
                    active = True
            elif deployment and deployment.get('status') == 'error':
                entry['failure'] = {'sha': pending['sha'], 'at': now, 'attempts': pending['attempts']}
                entry.pop('pending')
                log('deployment failed ' + branch + ' ' + pending['sha'])
            elif now - pending['queued_at'] > 1800 and info.get('composeStatus') != 'running':
                entry['failure'] = {'sha': pending['sha'], 'at': now, 'attempts': pending['attempts']}
                entry.pop('pending')
                log('deployment did not complete ' + branch)
            else:
                active = True
        if info.get('composeStatus') == 'running':
            active = True
    save(state_path, state)
    if active:
        return
    for target in targets:
        branch = target['branch']
        target_id = target.get('id', branch)
        info = statuses[target_id]
        sha = remote.get(branch)
        entry = state[target_id]
        if not sha or sha == entry.get('deployed') or not info.get('autoDeploy'):
            continue
        failure = entry.get('failure', {})
        attempts = failure.get('attempts', 0) if failure.get('sha') == sha else 0
        if attempts >= 3 or (attempts and now - failure['at'] < 300):
            continue
        title = 'CD ' + branch + ' ' + sha
        api(config, 'compose.deploy', {'composeId': target['compose_id'], 'title': title, 'description': 'Automatic Git branch update. Commit: ' + sha})
        entry['pending'] = {'sha': sha, 'title': title, 'queued_at': now, 'attempts': attempts + 1}
        save(state_path, state)
        log('queued ' + target_id + ' ' + sha)
        break


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', required=True)
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args()
    config_path = pathlib.Path(args.config)
    config = json.loads(config_path.read_text())
    state_path = pathlib.Path(config['state_file'])
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    while True:
        try:
            tick(config, state, state_path)
        except Exception as error:
            # Do not log HTTP headers, response bodies, config, or credentials.
            log('poll failed: ' + type(error).__name__)
            if args.once:
                raise SystemExit(1)
        if args.once:
            return
        time.sleep(config.get('interval_seconds', 30))


if __name__ == '__main__':
    main()
