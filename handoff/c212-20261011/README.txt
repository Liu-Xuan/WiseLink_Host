WiseLink exact code delta

Source commit: 6cd3c66336c3205dc40b755cc722b4d9b9ca554e
Required base: 94e09bcc2718fe4c6e4b7e6f35d8020994c87d6b
Expected result tree: 87a0c503d8f3440d65cb7a5c063a2a66b348e892

The patch contains all 51 changes from the required base to the source commit. It is an exact code delta, not a redacted implementation. It does not include the base, full changed-file snapshots, repository history or runtime records. The exact base must first be obtained through the authorized project Git route. Do not apply it blindly to another baseline.

Check SHA-256 values against manifest.json. In an isolated clean checkout of the exact base, run git apply --check, then git apply --index on the patch. git write-tree must equal the expected result tree. source-commit.txt is the original non-secret commit metadata; git hash-object -t commit on it must equal the source commit. Publication of this handoff is not an application release or a successful model execution.

The public handoff branch uses an existing public main commit solely as artifact storage. It is not the original 6cd3 source tree. Previous validation of the private source commit is not a build or test result for public main or this artifact-only branch.
