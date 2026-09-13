"""Use the existing status dashboard and its configured incident channel."""
import json
import pathlib
import sys
import urllib.request

config = json.loads(pathlib.Path('/etc/omniobserve-backup/notification.json').read_text())
mode = sys.argv[1]
if mode == 'success':
    url = 'https://status.skyhong.tw/api/heartbeat/omniobserve-backup'
    data = b'{}'
    headers = {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + config['heartbeatToken']}
elif mode in ('failure', 'test'):
    url = config['alertWebhook']
    content = ('[TEST] OmniObserve GPU 異機備份失敗通知通道驗證；這是部署驗收測試，服務並未因此中斷。'
               if mode == 'test' else
               'OmniObserve GPU 異機備份失敗。請檢查 omniobserve-backup.service；上次成功備份的時效可在 https://status.skyhong.tw/ 查看。')
    data = json.dumps({'content': content}).encode()
    headers = {'Content-Type': 'application/json', 'User-Agent': 'OmniObserve-Backup/1.0'}
else:
    raise SystemExit('Unknown notification mode')
try:
    request = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(request, timeout=20) as response:
        if not 200 <= response.status < 300:
            raise RuntimeError()
except Exception:
    raise SystemExit('Backup notification delivery failed; credentials suppressed')
print('Backup notification delivered:', mode)
