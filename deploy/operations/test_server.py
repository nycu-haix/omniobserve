import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('ops', Path(__file__).with_name('server.py'))
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)

class QueueTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old = ops.DATA
        ops.DATA = Path(self.temp.name)
        ops.initialize()
    def tearDown(self):
        ops.DATA = self.old
        self.temp.cleanup()
    def add(self, ident='a'*32, status='queued', next_run=0):
        with ops.db() as c:
            c.execute('INSERT INTO jobs(id,name,status,created,updated,size,next_run) VALUES (?,?,?,?,?,?,?)', (ident,'test.wav',status,1,1,12,next_run))
    def test_job_claimed_once(self):
        self.add()
        self.assertEqual(ops.claim()['attempts'],0)
        self.assertIsNone(ops.claim())
        with ops.db() as c:
            self.assertEqual(c.execute('SELECT attempts FROM jobs').fetchone()[0],1)
    def test_restart_recovers_running_job(self):
        self.add(status='processing');ops.initialize()
        self.assertEqual(ops.claim()['id'],'a'*32)
    def test_delayed_job_not_claimed(self):
        self.add(next_run=10**12)
        self.assertIsNone(ops.claim())
    def test_only_allowlisted_deployments_and_no_secrets(self):
        target={'branch':'sky','url':'https://sky.omni.observe.tw','compose_id':'allowed','console':'https://dokploy.observe.tw'}
        sha='a'*40
        with patch.object(ops,'TARGETS',{'sky':target}), patch.object(ops,'dokploy',return_value={'env':'SECRET','composeStatus':'done','autoDeploy':True,'deployments':[{'status':'done','createdAt':'2026','description':'Commit: '+sha,'title':'build'}]}) as call:
            result=ops.deployments()
        self.assertEqual(result[0]['commit'],sha)
        self.assertNotIn('SECRET',str(result))
        call.assert_called_once_with('compose.one',{'composeId':'allowed'},read=True)
    def test_unknown_commit_not_inferred(self):
        self.assertIsNone(ops.commit_of({'title':'random 12345678'}))

if __name__=='__main__': unittest.main()
