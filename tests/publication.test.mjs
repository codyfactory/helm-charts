import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { receipt, publishReceipt } from '../scripts/publication.mjs';

const archive=resolve('cody-execution-0.6.11.tgz');
async function fixture() {
  const before=process.cwd(), directory=mkdtempSync(join(tmpdir(),'chart-receipt-test-'));
  cpSync(archive,join(directory,'cody-execution-0.6.11.tgz'));process.chdir(directory);
  const bytes=readFileSync(archive), plan={version:'0.6.11',archive:'cody-execution-0.6.11.tgz',sourceCommit:'a'.repeat(40),publicationCommit:'b'.repeat(40)};
  const env={VERIFY_RUN_ID:'10',GITHUB_RUN_ID:'20',GITHUB_RUN_ATTEMPT:'1'};
  const value=await receipt(plan,env,async()=>({status:200,arrayBuffer:async()=>bytes}));
  const calls=[], state={existing:null,previous:value,publisher:'success',source:'success',errorAt:''};
  const command=args=>{
    calls.push(args);
    assert.ok(!args.includes('--paginate')&&!args.includes('--slurp'),'Publication must not scan release history');
    if(args[0]==='api') {
      if(state.errorAt && args[1].includes(state.errorAt))throw Error('GitHub unavailable');
      if(args[1]==='graphql') {
        return JSON.stringify({data:{repository:{nameWithOwner:'codyfactory/helm-charts',release:state.existing?{databaseId:1,tagName:state.existing.tag_name,isDraft:state.existing.draft}:null}}});
      }
      if(args[1]==='repos/codyfactory/helm-charts/releases/1')return JSON.stringify(state.existing);
      if(args[1]==='https://api.github.com/fixture/asset')return JSON.stringify(state.previous);
      const common={status:'completed',head_branch:'main',head_repository:{full_name:value.repository}};
      if(args[1].endsWith('/attempts/1'))return JSON.stringify({...common,status:state.publisher==='in_progress'?'in_progress':'completed',conclusion:state.publisher,event:'workflow_run',path:'.github/workflows/publish.yml'});
      assert.equal(args[1],'repos/codyfactory/helm-charts/actions/runs/10');
      return JSON.stringify({...common,conclusion:state.source,event:'push',head_sha:value.sourceCommit,path:'.github/workflows/verify.yml'});
    }
    assert.equal(args[0],'release');return '';
  };
  const existing=(draft=false,asset=true)=>{state.existing={tag_name:'cody-execution-0.6.11',draft,assets:asset?[{name:'publication.json',url:'https://api.github.com/fixture/asset'}]:[]};};
  return {value,plan,env,bytes,calls,state,command,existing,cleanup(){process.chdir(before);rmSync(directory,{recursive:true,force:true});}};
}
test('Public package bytes are verified before tag-specific metadata publication',async()=>{
  const f=await fixture();
  try {
    assert.equal(f.value.chart.size,f.bytes.length);assert.equal(f.value.publishRunId,'20');
    publishReceipt(f.value,f.command);
    assert.deepEqual(f.calls.filter(a=>a[0]==='release').map(a=>a[1]),['create','edit']);
    assert.ok(f.calls.find(a=>a[1]==='create').includes('--draft'));
    assert.ok(f.calls.find(a=>a[1]==='edit').includes('--draft=false'));
    await assert.rejects(receipt(f.plan,f.env,async()=>({status:200,arrayBuffer:async()=>Buffer.from('changed')})),/size differs/);
    await assert.rejects(receipt(f.plan,f.env,async()=>({status:404})),/HTTP 404/);
  } finally {f.cleanup();}
});
test('Successful public provenance survives reruns unchanged and can still notify',async()=>{
  const f=await fixture();
  try {
    f.existing();
    const next={...f.value,publishRunAttempt:'2',verifyRunId:'11'};
    assert.deepEqual(publishReceipt(next,f.command),f.value);
    assert.deepEqual(JSON.parse(readFileSync('artifacts/publication.json','utf8')),f.value);
    assert.equal(f.calls.filter(a=>a[0]==='release').length,0);
    assert.ok(f.calls.some(a=>a[1].endsWith('/20/attempts/1')));
    // A later cancellation of this rerun cannot change the original referenced attempt.
    assert.equal(JSON.parse(readFileSync('artifacts/publication.json','utf8')).publishRunAttempt,'1');
  } finally {f.cleanup();}
});
for(const draft of [true,false])for(const conclusion of ['failure','cancelled','timed_out'])test(`Matching ${draft?'draft':'public'} metadata with ${conclusion} provenance can be repaired`,async()=>{
  const f=await fixture();
  try {
    f.existing(draft);f.state.publisher=conclusion;
    const next={...f.value,publishRunAttempt:'2'};
    assert.deepEqual(publishReceipt(next,f.command),next);
    assert.deepEqual(JSON.parse(readFileSync('artifacts/publication.json','utf8')),next);
    assert.deepEqual(f.calls.filter(a=>a[0]==='release').map(a=>a[1]),draft?['upload','edit']:['upload']);
    assert.ok(f.calls.find(a=>a[1]==='upload').includes('--clobber'));
  } finally {f.cleanup();}
});
test('A draft without metadata resumes through the same tag without a history query',async()=>{
  const f=await fixture();
  try {f.existing(true,false);publishReceipt(f.value,f.command);assert.deepEqual(f.calls.filter(a=>a[0]==='release').map(a=>a[1]),['upload','edit']);}
  finally {f.cleanup();}
});
test('A draft with successful provenance finishes visibility without replacing its receipt',async()=>{
  const f=await fixture();
  try {
    f.existing(true);
    assert.deepEqual(publishReceipt({...f.value,publishRunAttempt:'2'},f.command),f.value);
    assert.deepEqual(f.calls.filter(a=>a[0]==='release').map(a=>a[1]),['edit']);
  } finally {f.cleanup();}
});
for(const failure of ['active','verify-failure','api-failure','identity','missing-public-asset','malformed'])test(`Invalid previous publication cannot be overwritten: ${failure}`,async()=>{
  const f=await fixture();
  try {
    f.existing();
    if(failure==='active')f.state.publisher='in_progress';
    if(failure==='verify-failure')f.state.source='failure';
    if(failure==='api-failure')f.state.errorAt='/attempts/';
    if(failure==='identity')f.state.previous={...f.value,sourceCommit:'f'.repeat(40)};
    if(failure==='missing-public-asset')f.existing(false,false);
    if(failure==='malformed')f.state.previous={...f.value,publishRunAttempt:'bad'};
    assert.throws(()=>publishReceipt({...f.value,publishRunAttempt:'2'},f.command));
    assert.equal(f.calls.filter(a=>a[0]==='release').length,0);
  } finally {f.cleanup();}
});
test('Lookup errors and unavailable repositories cannot be treated as absent releases',async()=>{
  const f=await fixture();
  try {
    for(const response of [{errors:[{message:'denied'}],data:{repository:null}},{data:{repository:null}},{data:{repository:{nameWithOwner:'other/repo',release:null}}}]) {
      assert.throws(()=>publishReceipt(f.value,args=>args[0]==='api'?JSON.stringify(response):f.command(args)));
    }
    f.state.errorAt='graphql';assert.throws(()=>publishReceipt(f.value,f.command),/GitHub unavailable/);
    assert.equal(f.calls.filter(a=>a[0]==='release').length,0);
  } finally {f.cleanup();}
});
