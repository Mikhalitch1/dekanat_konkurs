/** Invalidates late successes, errors and finally callbacks across account changes. */
export class RequestScope {
  private generation=0;
  private controller:AbortController|null=null;
  invalidate() { this.generation++;this.controller?.abort();this.controller=null; }
  begin() {
    this.invalidate();
    const generation=this.generation;
    const controller=new AbortController();this.controller=controller;
    return {signal:controller.signal,current:()=>generation===this.generation&&!controller.signal.aborted};
  }
}
