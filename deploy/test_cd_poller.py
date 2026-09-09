import importlib.util
import pathlib
import tempfile
import unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('poller',pathlib.Path(__file__).with_name('cd-poller.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class PollerTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.path=pathlib.Path(self.tmp.name)/'state.json'
        self.target={'branch':'sky','compose_id':'sky-service','initial_commit':'old','frontend':'sky.test','backend':'api.sky.test'}
        self.config={'repository':'https://example.test/repo.git','targets':[self.target]}
        self.info={'composeStatus':'done','autoDeploy':True,'deployments':[]};self.calls=[]
    def tearDown(self):self.tmp.cleanup()
    def run_tick(self,state,remote='new'):
        def api(config,method,data):
            if method=='compose.one':return self.info
            self.calls.append(data);return {'success':True}
        with patch.object(m.subprocess,'check_output',return_value=(remote+'\trefs/heads/sky\n').encode()),patch.object(m,'api',side_effect=api),patch.object(m,'healthy',return_value=True),patch.object(m,'log'):
            m.tick(self.config,state,self.path)
    def test_new_commit_queues_only_matching_service(self):
        state={};self.run_tick(state);self.assertEqual(self.calls[0]['composeId'],'sky-service');self.assertEqual(state['sky']['pending']['sha'],'new')
    def test_disabled_auto_deploy_is_respected(self):
        self.info['autoDeploy']=False;self.run_tick({});self.assertEqual(self.calls,[])
    def test_pending_job_is_not_queued_twice(self):
        state={'sky':{'deployed':'old','pending':{'sha':'new','title':'CD sky new','queued_at':m.time.time(),'attempts':1}}};self.run_tick(state);self.assertEqual(self.calls,[])
    def test_completed_job_is_recorded_after_health(self):
        state={'sky':{'deployed':'old','pending':{'sha':'new','title':'CD sky new','queued_at':m.time.time(),'attempts':1}}};self.info['deployments']=[{'title':'CD sky new','status':'done'}];self.run_tick(state);self.assertEqual(state['sky']['deployed'],'new');self.assertNotIn('pending',state['sky']);self.assertEqual(self.calls,[])
    def test_native_git_commit_metadata_is_recognized(self):
        state={'sky':{'deployed':'old','pending':{'sha':'new','title':'CD sky new','queued_at':m.time.time(),'attempts':1}}}
        self.info['deployments']=[{'title':'Git commit message replaces job title','description':'Commit: new','status':'done'}]
        self.run_tick(state);self.assertEqual(state['sky']['deployed'],'new');self.assertNotIn('pending',state['sky'])
    def test_failed_commit_stops_after_three_attempts(self):
        state={'sky':{'deployed':'old','failure':{'sha':'new','at':0,'attempts':3}}};self.run_tick(state);self.assertEqual(self.calls,[])
    def test_new_commit_can_recover_after_previous_failure(self):
        state={'sky':{'deployed':'old','failure':{'sha':'failed','at':0,'attempts':3}}};self.run_tick(state);self.assertEqual(len(self.calls),1)

class SharedBranchTests(unittest.TestCase):
    def test_two_services_on_same_branch_keep_independent_state(self):
        targets = [dict(branch='main', id=n, compose_id=n, initial_commit='old', health_checks=[['test.invalid', '/healthz']]) for n in ['web', 'asr']]
        info = {'composeStatus':'done', 'autoDeploy':True, 'deployments':[]}
        state = {'web': {'deployed':'new'}}
        calls = []
        def api(config, method, data):
            if method == 'compose.one': return info
            calls.append(data)
        with tempfile.TemporaryDirectory() as tmp, patch.object(m.subprocess,'check_output',return_value=b'new\trefs/heads/main\n'), patch.object(m,'api',side_effect=api), patch.object(m,'log'):
            m.tick({'repository':'test','targets':targets},state,pathlib.Path(tmp)/'state.json')
        self.assertEqual(calls[0]['composeId'], 'asr')
        self.assertEqual(state['web']['deployed'], 'new')
        self.assertEqual(state['asr']['pending']['sha'], 'new')

    def test_custom_health_path_does_not_require_frontend_fields(self):
        with patch.object(m.subprocess,'run') as run:
            run.return_value.returncode=0
            self.assertTrue(m.healthy({'health_checks':[['asr.test','/healthz']]}))
            self.assertIn('https://asr.test/healthz', run.call_args.args[0])

if __name__=='__main__':unittest.main()
