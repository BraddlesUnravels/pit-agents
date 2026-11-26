/** Letters, digits, ".", "_", "-"; starts with a letter or digit; no "..".
 *  Convention in this repo: lowercase-hyphen. */
export type Name = string;

/** This agent may ask another agent's worker for help. */
export interface WorkerUse {
  agent: Name;
  worker: Name;
}

/** `<agent>/agent.manifest.json`. `version` and `agent` are required.
 *  pit rejects unknown keys, wrong types and duplicate entries. */
export interface AgentManifest {
  version: string;
  agent: Name;
  workers?: Name[];
  skills?: Name[];
  scripts?: string[];
  uses?: WorkerUse[];
}

/** Request to borrow another agent's worker. An agreement in the agents'
 *  instructions; pit does not read or enforce it. */
export interface WorkerAccessRequest {
  requestingAgent: Name;
  toAgent: Name;
  worker: Name;
  reason: string;
}

export interface WorkerAccessReply {
  replyTo: Name;
  requestedWorker: Name;
  accessGranted: boolean;
}
