import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

/** Reuses the repository's existing constructed engineering fixture functions.
 * Top-level test registration is excluded by AST; no real PDF corpus is read. */
export async function loadEngineeringFixture(t, databaseUrl) {
  const path = resolve('test/node/engineering-matter-postgres.test.mjs');
  const source = await readFile(path, 'utf8');
  const tree = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.JS,
  );
  const declarations = tree.statements.filter(
    (statement) =>
      ts.isImportDeclaration(statement) ||
      ts.isVariableStatement(statement) ||
      ts.isFunctionDeclaration(statement) ||
      (ts.isExpressionStatement(statement) &&
        (statement.getText(tree).startsWith('process.env.') ||
          statement.getText(tree).startsWith('require('))),
  );
  const code = declarations
    .map((statement) => statement.getText(tree))
    .join('\n')
    .replace(
      'createRequire(import.meta.url)',
      `createRequire(${JSON.stringify(path)})`,
    )
    .replace(
      "import postgres from 'postgres';",
      `import postgres from ${JSON.stringify(import.meta.resolve('postgres'))};`,
    )
    .replaceAll('wiselink_r10_test', 'public');
  const root = await mkdtemp(
    join(tmpdir(), 'wiselink-wiki-engineering-fixture-'),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const module = join(root, 'engineering-fixture.mjs');
  process.env.ENGINEERING_MATTER_TEST_DATABASE_URL = databaseUrl;
  await writeFile(
    module,
    `${code}\nexport { resetDatabase, seedRealDocumentWorkItems, reserveActorService, matterResult, FTD_WORK_ITEM_ID, SB_WORK_ITEM_ID };\n`,
  );
  return import(pathToFileURL(module).href);
}
