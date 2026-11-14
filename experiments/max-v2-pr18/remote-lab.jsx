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
  const session=useMemo(()=>{
    const doc=new Y.Doc();
    const transport=createAuthenticatedConvexTransport({
      url:config.url,
      getToken:()=>clerk.session?.getToken({template:"convex"})??null,
    });
    const provider=new AuthorizedYjsProvider({
      doc,transport,workspaceId:config.workspaceId,pageId:config.pageId,onState:setStatus,
    });
    return {doc,provider};
  },[clerk]);
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
    session.provider.connect().catch(e=>setError(String(e.message??e)));
    return ()=>{void session.provider.destroy();session.doc.destroy();};
  },[session]);
  useEffect(()=>{
    window.__maxPr18={
    read:()=>({state:session.provider.state,pending:session.provider.pending.length,
      accountId:session.provider.accountId,cursor:session.provider.cursor,
      document:JSON.parse(JSON.stringify(editor.document)),
      error:session.provider.lastError?.message??null}),
    snapshot:()=>session.provider.exportSnapshot(),
    };
    return ()=>{delete window.__maxPr18;};
  },[session,editor]);
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
    <h1>Max 2.0 PR18 — isolated authenticated remote BlockNote lab</h1>
    <p>Test identities and synthetic documents only. Production Max data is forbidden.</p>
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
