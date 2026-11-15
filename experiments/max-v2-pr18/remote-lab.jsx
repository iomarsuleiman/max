/** PR18 operator-only sandbox. Never imported by the Max production app. */
import React,{useEffect,useMemo,useState} from "react";
import {createRoot} from "react-dom/client";
import {Clerk} from "@clerk/clerk-js";
import {useCreateBlockNote} from "@blocknote/react";
import {BlockNoteView} from "@blocknote/shadcn";
import {withCollaboration} from "@blocknote/core/yjs";
import * as Y from "yjs";
import {maxSchema} from "../../components/editor/blocks.tsx";
import {AuthorizedYjsProvider} from "./provider.mjs";
import {createIndexedDbJournal} from "./durable-journal.mjs";
import {acquireBrowserRoomLease} from "./room-lease.mjs";
import {createAuthenticatedConvexTransport} from "./transport.mjs";
import "@blocknote/shadcn/style.css";
import "./remote.css";

const root=document.getElementById("root");
const config={
  url:import.meta.env.VITE_PR18_CONVEX_URL,
  workspaceId:import.meta.env.VITE_PR18_WORKSPACE_ID,
  pageId:import.meta.env.VITE_PR18_PAGE_ID,
  clerkKey:import.meta.env.VITE_PR18_CLERK_PUBLISHABLE_KEY,
};
function save(bytes){
  const url=URL.createObjectURL(new Blob([bytes],{type:"application/octet-stream"}));
  const a=document.createElement("a"); a.href=url; a.download="max-pr18-local-review.yjs";a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function Lab({clerk}){
  const [status,setStatus]=useState({state:"idle",pending:0,canEdit:false,error:null});
  const [error,setError]=useState("");
  const [access,setAccess]=useState("checking");
  const session=useMemo(()=>{
    const doc=new Y.Doc();
    const transport=createAuthenticatedConvexTransport({
      url:config.url,
      getToken:()=>clerk.session?.getToken({template:"convex"})??null,
    });
    const provider=new AuthorizedYjsProvider({
      doc,transport,workspaceId:config.workspaceId,pageId:config.pageId,
      accountIdHint:clerk.user.id,journal:createIndexedDbJournal(),onState:setStatus,
    });
    return {doc,provider};
  },[clerk]);
  useEffect(()=>{
    let cancelled=false;
    let held=null;
    void (async()=>{
      try{
        // Do not mount the editor or open the shared IndexedDB outbox until
        // this origin owns the account+workspace+page Web Lock.
        const lease=await acquireBrowserRoomLease({
          accountId:clerk.user.id,workspaceId:config.workspaceId,pageId:config.pageId,
        });
        if(cancelled){lease.release();return;}
        held=lease;
        const pending=await session.provider.restorePending();
        if(cancelled)return;
        setAccess("ready");
        // Unreviewed pending bytes are NEVER automatically uploaded.
        if(!pending) await session.provider.connect();
      }catch(e){
        if(!cancelled){
          setError(String(e.message??e));
          if(!held)setAccess("denied");
        }
      }
    })();
    const stop=clerk.addListener(({user})=>{
      if(user?.id!==session.provider.journalScope.accountId){
        // Stop writes on account change before replacing this document.
        void session.provider.destroy();
        location.reload();
      }
    });
    return ()=>{
      cancelled=true;
      stop?.();
      // Release the lock only AFTER the provider's persistence barrier is
      // settled. Otherwise another tab can restore a stale outbox.
      void session.provider.destroy().finally(()=>held?.release());
      session.doc.destroy();
    };
  },[session,clerk]);
  return access==="ready"
    ? <LabEditor clerk={clerk} session={session} status={status} error={error} setError={setError}/>
    : <main><h1>Max PR23 isolated sandbox</h1><p role={access==="denied"?"alert":"status"}>
      {access==="denied"
        ? "Editing blocked: "+error+" — close the other tab or use a supported browser."
        : "Claiming exclusive room lease and checking durable recovery…"}
    </p></main>;
}
function LabEditor({clerk,session,status,error,setError}){
  const options=useMemo(()=>withCollaboration({
    schema:maxSchema,
    collaboration:{
      provider:session.provider,
      fragment:session.doc.getXmlFragment("max-document"),
      user:{name:"Sandbox editor",color:"#547aa5"},
    },
  }),[session]);
  const editor=useCreateBlockNote(options);
  useEffect(()=>{
    window.__maxPr18={
    read:()=>({state:session.provider.state,pending:session.provider.pending.length,
      canEdit:session.provider.canEdit,
      accountId:session.provider.accountId,cursor:session.provider.cursor,
      document:JSON.parse(JSON.stringify(editor.document)),
      error:session.provider.lastError?.message??null,
      ...(import.meta.env.VITE_PR22_ENABLE_TEST_HOOKS==="true" ? {deploymentUrl:config.url} : {})}),
    snapshot:()=>session.provider.exportSnapshot(),
    ...(import.meta.env.VITE_PR19_ENABLE_TEST_HOOKS==="true" ? {
      insertText:(text)=>{
        if(typeof text!=="string"||text.length>200||(!status.canEdit&&session.provider.state!=="offline"))
          throw Error("Sandbox edit denied");
        const id="pr19-"+crypto.randomUUID();
        editor.insertBlocks([{id,type:"paragraph",content:[{type:"text",text,styles:{}}]}],editor.document.at(-1),"after");
        return id;
      },
      persisted:()=>session.provider.persistBarrier,
      downgradeMemberEdit:(targetAccountId)=>session.provider.transport.downgradeMemberEdit({
        workspaceId:config.workspaceId,pageId:config.pageId,targetAccountId,
      }),
      revokeMember:(targetAccountId)=>session.provider.transport.revokeMember({
        workspaceId:config.workspaceId,pageId:config.pageId,targetAccountId,
      }),
    } : {}),


    // Available only in an isolated synthetic lab built with BOTH test flags.
    // Every action still uses real Clerk-authenticated, server-authorized Convex.
    ...(import.meta.env.VITE_PR19_ENABLE_TEST_HOOKS==="true" &&
        import.meta.env.VITE_PR22_ENABLE_TEST_HOOKS==="true" ? {
      captureTranscript: async (throughSeq=null) => {
        const p=session.provider;
        if(p.state!=="online"||!p.session)throw Error("NO_AUTHENTICATED_LIVE_SESSION");
        if(throughSeq!==null && (!Number.isSafeInteger(throughSeq)||throughSeq<0))
          throw Error("INVALID_FENCE");
        const pages=[];
        let afterSeq=0;
        let fence=throughSeq;
        for(let i=0;i<9;i++){
          const args={sessionId:p.session.sessionId,afterSeq,limit:32,
            ...(fence===null?{}:{throughSeq:fence})};
          const page=await p.transport.readUpdates(args);
          if(fence===null)fence=page.headSeq;
          if(page.headSeq!==fence||!Array.isArray(page.updates))throw Error("FENCE_CHANGED");
          for(const update of page.updates){
            if(update.seq!==afterSeq+1)throw Error("CHECKPOINT_STREAM_GAP");
            afterSeq=update.seq;
          }
          if(!page.hasMore && afterSeq!==fence)throw Error("CHECKPOINT_STREAM_TRUNCATED");
          pages.push(page);
          if(!page.hasMore)return {
            scope:{workspaceId:config.workspaceId,pageId:config.pageId},headSeq:fence,pages,
          };
          if(!page.updates.length)throw Error("EMPTY_STREAM_PAGE");
        }
        throw Error("BACKUP_CAPTURE_PAGE_BUDGET_EXCEEDED");
      },
      compactOnce: async () => {
        if(session.provider.state!=="online"||!session.provider.session)
          throw Error("NO_AUTHENTICATED_LIVE_SESSION");
        return session.provider.transport.compactLog({
          sessionId:session.provider.session.sessionId,
        });
      },
      checkpointStatus: async () => {
        if(session.provider.state!=="online"||!session.provider.session)
          throw Error("NO_AUTHENTICATED_LIVE_SESSION");
        return session.provider.transport.checkpointStatus({
          sessionId:session.provider.session.sessionId,
        });
      },
    } : {}),
    };
    return ()=>{delete window.__maxPr18;};
  },[session,editor,status.canEdit,status.state]);
  function fixture(){
    if(status.state!=="online"||!status.canEdit) return;
    editor.insertBlocks([
      {id:"pr18-callout",type:"callout",props:{tone:"tip"},
        content:[{type:"text",text:"مرحبا Max remote collaboration",styles:{}}]},
      {id:"pr18-page-link",type:"pageLink",props:{pageId:"fixturepage001"}},
      {id:"pr18-bookmark",type:"bookmark",props:{url:"https://example.com",title:"Example"}},
    ],editor.document.at(-1),"after");
  }
  async function reviewReconnect(){
    const pending=session.provider.pending.length;
    if(pending && !window.confirm("Review/export local edits before replaying them into the remote room?")) return;
    if(pending) save(session.provider.exportSnapshot());
    try{await session.provider.connect({reviewedPending:true});setError("");}
    catch(e){setError(String(e.message??e));}
  }
  return <main>
    <h1>Max 2.0 PR19 — durable offline recovery + remote BlockNote lab</h1>
    <p>Test identities and synthetic documents only. Pending Yjs updates stay in account-scoped IndexedDB until server acknowledgment. Production Max data is forbidden.</p>
    <p>Identity: {clerk.user?.id} · Scope: {config.workspaceId}/{config.pageId}</p>
    <p role="status">State: {status.state} · Pending: {status.pending} · Edit access: {String(status.canEdit)}</p>
    {(error||status.error)&&<p role="alert">{error||status.error}</p>}
    <nav>
      <button disabled={status.state!=="online"||!status.canEdit} onClick={fixture}>Insert Arabic/custom blocks</button>
      <button onClick={()=>session.provider.disconnect()}>Go offline</button>
      <button onClick={reviewReconnect}>Review, export & reconnect</button>
      <button onClick={()=>save(session.provider.exportSnapshot())}>Export Yjs snapshot</button>
    </nav>
    <BlockNoteView editor={editor} editable={(status.state==="online"&&status.canEdit)||(status.state==="offline"&&session.provider.lastAuthorizedCanEdit)}/>
  </main>;
}
async function boot(){
  if(Object.values(config).some(v=>!v)){
    root.textContent="Missing VITE_PR18 sandbox Convex URL, Clerk publishable key, workspace ID, or page ID.";
    return;
  }
  try{
    const domain=atob(config.clerkKey.split("_")[2]??"").slice(0,-1);
    if(!/^[a-z0-9.-]+$/i.test(domain)) throw Error("Invalid Clerk domain");
    await new Promise((resolve,reject)=>{
      const script=document.createElement("script");
      script.src="https://"+domain+"/npm/@clerk/ui@1/dist/ui.browser.js";
      script.crossOrigin="anonymous";script.onload=resolve;
      script.onerror=()=>reject(Error("Clerk UI bundle unavailable"));document.head.appendChild(script);
    });
    const clerk=new Clerk(config.clerkKey);
    await clerk.load({ui:{ClerkUI:window.__internal_ClerkUICtor}});
    if(!clerk.isSignedIn||!clerk.session){
      root.innerHTML='<p>Sign into the dedicated sandbox Clerk tenant.</p><div id="sign-in"></div>';
      clerk.mountSignIn(document.getElementById("sign-in"));
      clerk.addListener(({user,session})=>{if(user&&session)location.reload();});
      return;
    }
    createRoot(root).render(<Lab clerk={clerk}/>);
  }catch(e){root.textContent="Sandbox startup rejected: "+String(e.message??e);}
}
void boot();
