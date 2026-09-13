"""Export only the TURN certificate from Traefik's managed ACME store."""
import base64
import json
import os
import pathlib
import subprocess

store = pathlib.Path('/etc/dokploy/traefik/dynamic/acme.json')
target = pathlib.Path('/etc/omniobserve-turn/certs')
target.mkdir(parents=True, exist_ok=True, mode=0o700)
os.chown(target, 65534, 65534)
changed = False
found = False
for config in json.loads(store.read_text()).values():
    for cert in config.get('Certificates', []):
        if cert.get('domain', {}).get('main') != 'turn.omni.observe.tw':
            continue
        found = True
        for field, name in [('certificate', 'fullchain.pem'), ('key', 'privkey.pem')]:
            value = base64.b64decode(cert[field])
            path = target / name
            if path.exists() and path.read_bytes() == value:
                os.chown(path, 65534, 65534)
                continue
            temp = path.with_suffix('.new')
            temp.write_bytes(value)
            temp.chmod(0o600)
            os.chown(temp, 65534, 65534)
            temp.replace(path)
            changed = True
if not found:
    raise SystemExit('TURN certificate not yet issued')
if changed and subprocess.run(['docker', 'inspect', 'omniobserve-turn'], capture_output=True).returncode == 0:
    subprocess.run(['docker', 'restart', 'omniobserve-turn'], check=True, stdout=subprocess.DEVNULL)
print('TURN certificate synchronized')
