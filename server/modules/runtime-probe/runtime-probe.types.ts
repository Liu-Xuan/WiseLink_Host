export interface RuntimeProbeCheck {
  status: 'PASS' | 'FAIL';
  detail: string;
}

export interface RuntimeProbeResponse {
  schemaVersion: 'wiselink.3_1.hosted_runtime_probe.v1';
  status: 'PASS' | 'BLOCKED';
  appId: 'app_17bzc551rsg';
  deployedCommit: string;
  releaseId: string;
  apiContractVersion: 'wiselink.3_1.canonical_host.r06.0';
  selectedContract: {
    contractId: 'techpub.parsed-package.v1';
    contractRevision: 'frozen.2';
    u0Commit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900';
    manifestSha256: '730baa88e7254bac6d3808ca2ddbfb1824c5891d6ce3d6d29ce177431cd5ffc0';
  };
  checks: {
    pythonExecutable: RuntimeProbeCheck;
    childProcess: RuntimeProbeCheck;
    temporaryFile: RuntimeProbeCheck;
    jsonschemaDependency: RuntimeProbeCheck;
    exactU0Manifest: RuntimeProbeCheck;
    exactU0Scripts: RuntimeProbeCheck;
    strictReader: RuntimeProbeCheck;
  };
  authority: {
    businessWriteAuthorized: false;
    artifactPersistAuthorized: false;
    baseRecordWriteAuthorized: false;
    publicationDecisionCreated: false;
  };
  blockers: string[];
}
