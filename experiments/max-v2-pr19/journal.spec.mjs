import {test,expect} from "@playwright/test";
test("actual IndexedDB holds exact Yjs bytes across reload; isolates account and page; ack deletes",async({page})=>{
  await page.goto("/journal-test.html");
  const entry=await page.evaluate(()=>window.__pr19Journal.stage());
  await page.reload();
  const stored=await page.evaluate(()=>window.__pr19Journal.read());
  expect(stored).toEqual([entry]);
  expect(await page.evaluate(()=>window.__pr19Journal.replay())).toBe("عربي offline — durable ✅");
  expect(await page.evaluate(()=>window.__pr19Journal.read("bob"))).toEqual([]);
  expect(await page.evaluate(()=>window.__pr19Journal.read("alice","other"))).toEqual([]);
  await page.evaluate(async(entry)=>{await window.__pr19Journal.ack(entry.operationId);},entry);
  expect(await page.evaluate(()=>window.__pr19Journal.read())).toEqual([]);
});
test("duplicate operation matches exactly and conflicting retry fails closed",async({page})=>{
  await page.goto("/journal-test.html");
  const entry=await page.evaluate(()=>window.__pr19Journal.stage());
  const out=await page.evaluate(async(e)=>{
    const {createIndexedDbJournal}=await import("/durable-journal.mjs");
    return createIndexedDbJournal().append({accountId:"alice",workspaceId:"pr19-lab",pageId:"page1"},e);
  },entry);
  expect(out).toBe(false);
  await expect(page.evaluate(async(e)=>window.__pr19Journal.rejectConflictingRetry(e),entry)).rejects.toThrow();
  expect(await page.evaluate(()=>window.__pr19Journal.read())).toEqual([entry]);
});
