import { LocalReadLeaseDeadline } from "./read-lease-deadline.mjs";
/** PR26: a read-only-by-default adapter for isolated synthetic lab threads.
 * Server ACLs are authoritative. A session ID never grants access by itself.
 * No localStorage, outbox, notifications or production editor integration.
 */
const BLOCK=/^[A-Za-z0-9_.:@-]{1,128}$/;
const MAX_THREADS=32,MAX_COMMENTS=32;
function normalizeThreads(rows){
  if(!Array.isArray(rows)||rows.length>MAX_THREADS)throw Error("INVALID_THREADS_RESPONSE");
  const seen=new Set();
  return rows.map(row=>{
    if(!row||typeof row.threadId!=="string"||!row.threadId||
        seen.has(row.threadId)||typeof row.blockId!=="string"||!BLOCK.test(row.blockId)||
        !(row.resolvedAt===null||Number.isSafeInteger(row.resolvedAt))||
        !Number.isSafeInteger(row.revision)||row.revision<1||typeof row.canResolve!=="boolean")
      throw Error("INVALID_THREAD");
    seen.add(row.threadId);
    return {threadId:row.threadId,blockId:row.blockId,
      resolvedAt:row.resolvedAt,revision:row.revision,canResolve:row.canResolve};
  });
}
function normalizeComments(rows){
  if(!Array.isArray(rows)||rows.length>MAX_COMMENTS)throw Error("INVALID_COMMENTS_RESPONSE");
  const seen=new Set();
  return rows.map(row=>{
    if(!row||typeof row.commentId!=="string"||!row.commentId||seen.has(row.commentId)||
        !(row.authorId===null||(typeof row.authorId==="string"&&row.authorId.length>0))||
        typeof row.body!=="string"||row.body.length>2000||
        !Array.isArray(row.mentions)||row.mentions.length>3||
        !row.mentions.every(id=>typeof id==="string"&&id.length>0)||
        !Number.isSafeInteger(row.createdAt)||!["initial","reply"].includes(row.kind))
      throw Error("INVALID_COMMENT");
    seen.add(row.commentId);
    return {commentId:row.commentId,authorId:row.authorId,body:row.body,
      mentions:row.mentions.slice(),createdAt:row.createdAt,kind:row.kind};
  });
}
const opId=()=>crypto.randomUUID().replaceAll("-","");
export class LabCommentClient{
  constructor({provider,onChange=()=>{},onError=()=>{},now=()=>Date.now(), scheduleExpiry = (fn, ms) => setTimeout(fn, ms), cancelExpiry = id => clearTimeout(id) }){
    if(!provider?.transport||typeof provider.on!=="function"||typeof provider.off!=="function")
      throw Error("Authorized sandbox provider required");
    this.provider=provider;this.transport=provider.transport;
    this.onChange=onChange;this.onError=onError;this.now=now;
    this.started=false;this.generation=0;this.sessionId=null;
    this.offAccess=null;this.offThreads=null;this.offComments=null;
    this.canComment=false;this.threads=[];this.comments=[];this.selectedThreadId=null;
    this._status=()=>this.reconcile();
    this._deadline = new LocalReadLeaseDeadline({
      now, schedule: scheduleExpiry, cancel: cancelExpiry,
      onExpire: () => this._fail(Error("READ_LEASE_EXPIRED"), this.generation),
    });
  }
  _live(){
    const p=this.provider;
    return p.state==="online"&&!!p.session?.sessionId&&p.accountId===p.session.accountId&&
      Number.isFinite(p.session.expiresAt)&&p.session.expiresAt>this.now();
  }
  _snapshot(){
    this.onChange({connected:this._live()&&!!this.sessionId,canComment:this.canComment,
      threads:this.threads.slice(),comments:this.comments.slice(),selectedThreadId:this.selectedThreadId});
  }
  _clear(){
    this._deadline.clear();
    this.generation++;
    this.offAccess?.();this.offThreads?.();this.offComments?.();
    this.offAccess=this.offThreads=this.offComments=null;
    this.sessionId=null;this.canComment=false;this.threads=[];this.comments=[];this.selectedThreadId=null;
    this._snapshot();
  }
  _fail(err,gen){
    if(gen!==this.generation)return;
    this._clear();
    this.onError(err instanceof Error?err:Error(String(err)));
  }
  start(){
    if(this.started)return;
    this.started=true;this.provider.on("status",this._status);
    this.reconcile();
  }
  reconcile(){
    if(!this.started)return;
    if(!this._live()){if(this.sessionId)this._clear();return;}
    const sessionId=this.provider.session.sessionId;
    if(sessionId===this.sessionId)return;
    this._clear();this.sessionId=sessionId;
    const gen=this.generation;
    try { this._deadline.arm(this.provider.session.expiresAt); }
    catch (error) { this._fail(error, this.generation); return; }
    if (!this.started || !this.sessionId) return;
    if(typeof this.transport.watchCommentAccess!=="function"||
        typeof this.transport.watchCommentThreads!=="function"||
        typeof this.transport.watchThreadComments!=="function") {
      this._fail(Error("COMMENT_TRANSPORT_UNAVAILABLE"),gen);return;
    }
    const valid=()=>this.started&&gen===this.generation&&this._live()&&this.sessionId===sessionId;
    try{
      this.offAccess=this.transport.watchCommentAccess({sessionId},value=>{
        if(!valid())return;
        if(typeof value!=="boolean"){this._fail(Error("INVALID_COMMENT_PERMISSION"),gen);return;}
        this.canComment=value;this._snapshot();
      },error=>this._fail(error,gen));
      this.offThreads=this.transport.watchCommentThreads({sessionId},rows=>{
        if(!valid())return;
        try{
          this.threads=normalizeThreads(rows);
          if(this.selectedThreadId&&!this.threads.some(t=>t.threadId===this.selectedThreadId))
            this.selectThread(null);
          this._snapshot();
        }catch(e){this._fail(e,gen);}
      },error=>this._fail(error,gen));
    }catch(e){this._fail(e,gen);}
    this._snapshot();
  }
  selectThread(threadId){
    if(threadId!==null&&(!this.sessionId||!this.threads.some(t=>t.threadId===threadId)))
      throw Error("UNKNOWN_THREAD");
    this.offComments?.();this.offComments=null;this.comments=[];this.selectedThreadId=threadId;
    const gen=this.generation,sessionId=this.sessionId;
    if(threadId&&this._live()){
      try{
        this.offComments=this.transport.watchThreadComments({sessionId,threadId},rows=>{
          if(gen!==this.generation||!this._live()||this.selectedThreadId!==threadId)return;
          try{this.comments=normalizeComments(rows);this._snapshot();}
          catch(e){this._fail(e,gen);}
        },error=>this._fail(error,gen));
      }catch(e){this._fail(e,gen);}
    }
    this._snapshot();
  }
  async _write(name,payload){
    if(!this.started||!this._live()||!this.sessionId||!this.canComment)
      throw Error("COMMENT_ACCESS_REQUIRED");
    const gen=this.generation,sessionId=this.sessionId;
    const result=await this.transport[name]({sessionId,...payload});
    if(gen!==this.generation||sessionId!==this.sessionId||!this._live())
      throw Error("COMMENT_SESSION_CHANGED_AFTER_WRITE");
    return result;
  }
  async create({blockId,body,mentions=[],operationId=opId()}){
    if(typeof blockId!=="string"||!BLOCK.test(blockId))throw Error("UNKNOWN_BLOCK_ANCHOR");
    return this._write("createCommentThread",{blockId,body,mentions,operationId});
  }
  async reply({threadId,body,mentions=[],operationId=opId()}){
    if(!this.threads.some(t=>t.threadId===threadId))throw Error("UNKNOWN_THREAD");
    return this._write("replyToCommentThread",{threadId,body,mentions,operationId});
  }
  async resolve({threadId,expectedRevision,resolved}){
    const thread=this.threads.find(t=>t.threadId===threadId);
    if(!thread||!thread.canResolve||thread.revision!==expectedRevision)
      throw Error("COMMENT_RESOLUTION_NOT_ALLOWED");
    return this._write("resolveCommentThread",{threadId,expectedRevision,resolved});
  }
  stop(){
    if(!this.started)return;
    this.started=false;this.provider.off("status",this._status);this._clear();
  }
}
