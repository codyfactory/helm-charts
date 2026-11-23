import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { receipt, publishReceipt } from '../scripts/publication.mjs';

const archive=resolve('cody-execution-0.6.11.tgz');
test('Public package bytes are verified before recording the durable chart publication', async()=>{
  const before=process.cwd(),directory=mkdtempSync(join(tmpdir(),'chart-receipt-test-'));
  try{
    cpSync(archive,join(directory,'cody-execution-0.6.11.tgz'));process.chdir(directory);
    const bytes=readFileSync(archive),plan={version:'0.6.11',archive:'cody-execution-0.6.11.tgz',sourceCommit:'a'.repeat(40),publicationCommit:'b'.repeat(40)};
    const env={VERIFY_RUN_ID:'10',GITHUB_RUN_ID:'20',GITHUB_RUN_ATTEMPT:'1'};
    const result=await receipt(plan,env,async()=>({status:200,arrayBuffer:async()=>bytes}));
    assert.equal(result.chart.version,'0.6.11');assert.equal(result.chart.size,bytes.length);assert.equal(result.publishRunId,'20');
    const calls=[];const command=args=>{calls.push(args);return args[0]==='api'?'[[]]':'';};
    publishReceipt(result,command);
    assert.equal(calls.filter(args=>args[0]==='release'&&args[1]==='create').length,1);
    assert.ok(calls.find(args=>args[1]==='create').includes('--draft'));
    assert.ok(calls.find(args=>args[1]==='edit').includes('--draft=false'));
    await assert.rejects(receipt(plan,env,async()=>({status:200,arrayBuffer:async()=>Buffer.from('changed')})),/size differs/);
    await assert.rejects(receipt(plan,env,async()=>({status:404})),/HTTP 404/);
    const existing={tag_name:'cody-execution-0.6.11',draft:false,assets:[{name:'publication.json',url:'https://api.github.com/asset'}]};
    publishReceipt({...result,publishRunAttempt:'2'},args=>args.includes('--slurp')?JSON.stringify([[existing]]):args[0]==='api'?JSON.stringify(result):'');
    const changed=structuredClone(result);changed.chart.sha256='f'.repeat(64);
    assert.throws(()=>publishReceipt(changed,args=>args.includes('--slurp')?JSON.stringify([[existing]]):JSON.stringify(result)),/bytes changed/);
  }finally{process.chdir(before);rmSync(directory,{recursive:true,force:true});}
});
