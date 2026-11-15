/** PR18 operator-only sandbox. Never imported by the Max production app. */
import React,{useEffect,useMemo,useState,useRef} from "react";
import {createRoot} from "react-dom/client";
import {Clerk} from "@clerk/clerk-js";
import {useCreateBlockNote} from "@blocknote/react";
import {BlockNoteView} from "@blocknote/shadcn";
import {withCollaboration} from "@blocknote/core/yjs";
import * as Y from "yjs";
import {maxSchema} from "../../components/editor/blocks.tsx";
import {AuthorizedYjsProvider} from "./provider.mjs";
import {LabPresenceClient} from "./presence.mjs";
import {LabCommentClient} from "./comments.mjs";
import {createIndexedDbJournal} from "./durable-journal.mjs";
import {acquireBrowserRoomLease} from "./room-lease.mjs";
import {createMeteredTransport} from "./transport-meter.mjs";
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
    const transport=createMeteredTransport(createAuthenticatedConvexTransport({
      url:config.url,
      getToken:()=>clerk.session?.getToken({template:"convex"})??null,
    }));
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
/**
 * PR25 opt-in synthetic preview. No production editor import, no remote names
 * or profile images, and no character-accurate caret claim. The underlying
 * server verifies current Clerk identity and page permissions on each request.
 */
function PresencePreview({editor,provider,onError}){
  const enabled=import.meta.env.VITE_PR25_ENABLE_AWARENESS_LAB==="true";
  const [peers,setPeers]=useState([]);
  const [invisible,setInvisible]=useState(false);
  const client=useRef(null);
  useEffect(()=>{
    if(!enabled)return;
    const awareness=new LabPresenceClient({
      provider,onChange:setPeers,onError:e=>onError("Awareness unavailable: "+e.message),
    });
    client.current=awareness;
    awareness.start();
    return ()=>{
      if(client.current===awareness)client.current=null;
      awareness.stop();
    };
  },[provider,onError,enabled]);
  useEffect(()=>{
    if(!enabled)return;
    const changed=()=>{
      // Block identity only: zero offsets are a protocol placeholder, NOT a
      // precise caret or range; never transmit composed Arabic text.
      let id=null;
      try{id=editor.getTextCursorPosition()?.block?.id??null;}catch{}
      client.current?.setFocusBlock(id);
    };
    const stop=editor.onSelectionChange(changed);
    changed();
    return ()=>stop?.();
  },[editor,enabled]);
  if(!enabled)return null;
  return <section className="pr25-presence" aria-label="Experimental collaborator awareness">
    <div className="pr25-presence-head">
      <span>Collaborators · sandbox preview</span>
      <button type="button" aria-pressed={invisible} onClick={()=>{
        setInvisible(v=>{client.current?.setVisible(v);return !v;});
      }}>{invisible?"Invisible (on)":"Visible to collaborators"}</button>
    </div>
    <div role="list" aria-label="Current authorized collaborators" className="pr25-peers">
      {peers.slice(0,5).map((peer,i)=><span
        role="listitem" key={peer.accountId} className={"pr25-peer "+peer.state}
        title={"Collaborator "+(i+1)+": "+(peer.state==="editing"?"editing a block":"viewing")}
        aria-label={"Collaborator "+(i+1)+", "+(peer.state==="editing"?"editing a block":"viewing")}
      >{i+1}</span>)}
      {peers.length>5&&<span className="pr25-peer-extra">+{peers.length-5}</span>}
      {peers.length===0&&<span className="pr25-empty">No other active collaborators</span>}
    </div>
    {peers.some(p=>p.state==="editing"&&p.blockId)&&
      <p className="pr25-focus">Remote block focus available (no precise text cursors yet).</p>}
    <p className="pr25-caveat">Short-lived presence only. Names, note text and cursor offsets are never displayed.</p>
  </section>;
}


/** PR26: explicitly enabled operator preview. Only real, server-authorized
 * subjects can be mentioned; no identity directory or synthetic notifications.
 * Missing blocks are orphaned visibly rather than guessed from text offsets.
 */
function CommentsPreview({editor,provider,onError}){
  const enabled=import.meta.env.VITE_PR26_ENABLE_COMMENT_LAB==="true";
  const [data,setData]=useState({connected:false,canComment:false,threads:[],comments:[],selectedThreadId:null});
  const [focus,setFocus]=useState(null);
  const [draft,setDraft]=useState("");
  const [mentionInput,setMentionInput]=useState("");
  const [documentVersion,setDocumentVersion]=useState(0);
  const adapter=useRef(null);
  useEffect(()=>{
    if(!enabled)return;
    const c=new LabCommentClient({provider,onChange:setData,onError:e=>onError("Comments unavailable: "+e.message)});
    adapter.current=c;c.start();
    return ()=>{if(adapter.current===c)adapter.current=null;c.stop();};
  },[provider,onError,enabled]);
  useEffect(()=>{
    if(!enabled)return;
    const selection=()=>{
      try{setFocus(editor.getTextCursorPosition()?.block?.id??null);}
      catch{setFocus(null);}
    };
    const stopSelection=editor.onSelectionChange(selection);
    const stopDoc=editor.onChange(()=>setDocumentVersion(v=>v+1));
    selection();
    return ()=>{stopSelection?.();stopDoc?.();};
  },[editor,enabled]);
  const blocks=useMemo(()=>{
    const ids=new Set();
    const visit=items=>{for(const block of items??[]){if(block?.id)ids.add(block.id);visit(block?.children);}};
    visit(editor.document);
    return ids;
  },[editor,documentVersion]);
  if(!enabled)return null;
  const selected=data.threads.find(t=>t.threadId===data.selectedThreadId);
  const mentions=()=>mentionInput.split(",").map(s=>s.trim()).filter(Boolean);
  const execute=async work=>{
    try{await work();setDraft("");setMentionInput("");}
    catch(e){onError("Comments: "+String(e.message??e));}
  };
  const canWrite=data.connected&&data.canComment;
  return <section className="pr26-comments" aria-label="Experimental anchored comments and mentions">
    <div className="pr26-head"><strong>Block comments · sandbox preview</strong>
      <span>{canWrite?"Comment permission verified":data.connected?"Read only":"Disconnected"}</span>
    </div>
    <p className="pr26-help">Selected block: <code>{focus??"none"}</code>. Comments track an exact block ID, never a character offset.</p>
    <label htmlFor="pr26-comment-draft">New thread or reply</label>
    <textarea id="pr26-comment-draft" value={draft} maxLength={2000} rows={2}
      onChange={e=>setDraft(e.target.value)} placeholder="Add a comment to this block…"/>
    <label htmlFor="pr26-mentions">Mention exact authorized account IDs (comma separated, max 3)</label>
    <input id="pr26-mentions" value={mentionInput} onChange={e=>setMentionInput(e.target.value)}
      placeholder="Optional Clerk subject IDs" autoComplete="off"/>
    <div className="pr26-actions">
      <button type="button" disabled={!canWrite||!focus||!blocks.has(focus)||!draft.trim()}
        onClick={()=>execute(async()=>{
          const result=await adapter.current.create({blockId:focus,body:draft,mentions:mentions()});
          // Reactive thread list may arrive after the mutation acknowledgment.
          if(!result?.threadId)throw Error("COMMENT_CREATE_UNACKNOWLEDGED");
        })}>Comment on selected block</button>
      <button type="button" disabled={!canWrite||!selected||selected.resolvedAt!==null||!draft.trim()}
        onClick={()=>execute(()=>adapter.current.reply({threadId:selected.threadId,body:draft,mentions:mentions()}))}>
        Reply to selected thread</button>
    </div>
    <div className="pr26-thread-list" role="group" aria-label="Anchored discussion threads">
      {data.threads.length===0&&<p>No sandbox threads yet.</p>}
      {data.threads.map(t=><button key={t.threadId} type="button"
        aria-pressed={data.selectedThreadId===t.threadId}
        onClick={()=>adapter.current?.selectThread(t.threadId)}>
        <span>{t.blockId}</span>
        <span>{!blocks.has(t.blockId)?" · Missing anchor":t.resolvedAt?" · Resolved":" · Open"}</span>
      </button>)}
    </div>
    {selected&&<div className="pr26-thread-panel">
      <div className="pr26-head"><strong>Thread at {selected.blockId}</strong>
        {selected.canResolve&&<button type="button" disabled={!canWrite} onClick={()=>execute(()=>
          adapter.current.resolve({threadId:selected.threadId,expectedRevision:selected.revision,resolved:selected.resolvedAt===null})
        )}>{selected.resolvedAt?"Reopen":"Resolve"}</button>}
      </div>
      {!blocks.has(selected.blockId)&&<p role="status" className="pr26-orphan">
        Anchored block missing from this Yjs document. Thread remains intact; no automatic reattachment.
      </p>}
      <ol>{data.comments.map(c=><li key={c.commentId}>
        <strong>{c.authorId??"Former collaborator"}</strong>
        <p>{c.body}</p>
        {c.mentions.length>0&&<small>Mentions: {c.mentions.join(", ")}</small>}
      </li>)}</ol>
    </div>}
    <p className="pr26-help">No email/name directory, mention delivery, text-range anchors or production data.</p>
  </section>;
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
      operationEvidence: () => session.provider.transport.operationEvidence(),
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
    <PresencePreview editor={editor} provider={session.provider} onError={setError}/>
    <CommentsPreview editor={editor} provider={session.provider} onError={setError}/>
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
