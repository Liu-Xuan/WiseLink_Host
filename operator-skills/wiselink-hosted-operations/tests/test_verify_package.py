import hashlib
import importlib.util
import json
import tempfile
import unittest
import warnings
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location('verifier', Path(__file__).parents[1] / 'scripts/verify-package.py')
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


class PackageVerification(unittest.TestCase):
    def test_real_file_checks_and_unsafe_entries(self):
        with tempfile.TemporaryDirectory() as temporary:
            archive = Path(temporary) / 'skill.zip'
            manifest_path = Path(temporary) / 'manifest.json'
            root, body = 'wiselink-research-and-synthesize', b'candidate-only\n'
            cases = {
                'valid': [(f'{root}/SKILL.md', body, 0o100644)],
                'changed_body': [(f'{root}/SKILL.md', b'changed body', 0o100644)],
                'missing_file': [(f'{root}/', b'', 0o40755)],
                'symlink': [(f'{root}/SKILL.md', body, 0o120777)],
                'duplicate': [(f'{root}/SKILL.md', body, 0o100644)] * 2,
                'directory_traversal': [(f'{root}/../escape/', b'', 0o40755), (f'{root}/SKILL.md', body, 0o100644)],
                'unexpected_file': [(f'{root}/SKILL.md', body, 0o100644), (f'{root}/extra', b'x', 0o100644)],
            }
            for name, entries in cases.items():
                with self.subTest(name=name):
                    with warnings.catch_warnings():
                        warnings.simplefilter('ignore', UserWarning)
                        with zipfile.ZipFile(archive, 'w') as package:
                            for path, data, mode in entries:
                                info = zipfile.ZipInfo(path)
                                info.create_system = 3
                                info.external_attr = mode << 16
                                package.writestr(info, data)
                    # Refresh archive hash even for bad entries: tests must reach file-level checks.
                    payload = archive.read_bytes()
                    manifest = {
                        'schemaVersion': 'wiselink.skill-publish-lite.v1', 'slug': root,
                        'version': f'{root}@r09.c1', 'source': {'gitCommit': 'isolated-test'},
                        'archive': {'rootDirectory': root, 'byteLength': len(payload),
                                    'sha256': hashlib.sha256(payload).hexdigest(), 'fileCount': 1},
                        'files': [{'path': 'SKILL.md', 'mode': '100644', 'byteLength': len(body),
                                   'sha256': hashlib.sha256(body).hexdigest()}],
                    }
                    manifest_path.write_text(json.dumps(manifest))
                    if name == 'valid':
                        self.assertEqual(verifier.verify(archive, manifest_path)['files'], 1)
                        with self.assertRaisesRegex(ValueError, 'accepted SHA mismatch'):
                            verifier.verify(archive, manifest_path, '0' * 64)
                    else:
                        with self.assertRaises(ValueError):
                            verifier.verify(archive, manifest_path)


if __name__ == '__main__':
    unittest.main()
