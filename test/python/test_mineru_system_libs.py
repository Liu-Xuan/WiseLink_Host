import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('system_libs', Path(__file__).parents[2] / 'server/runtime-assets/mineru/restore-system-libs.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SystemLibrariesTest(unittest.TestCase):
    def archive(self, path, extra=None, corrupt=False):
        payload = {'lib/' + name: name.encode() for name in ['libGL.so.1', 'libGLX.so.0', 'libGLdispatch.so.0']}
        manifest = {'schemaVersion': 'wiselink.mineru.system-libs.v1', 'target': 'linux-x64', 'files': [
            {'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()} for name, data in payload.items()]}
        payload['manifest.json'] = json.dumps(manifest).encode()
        if corrupt:
            payload['lib/libGL.so.1'] = b'corrupt'
        with tarfile.open(path, 'w') as archive:
            for name, data in payload.items():
                member = tarfile.TarInfo(name)
                member.size = len(data)
                archive.addfile(member, io.BytesIO(data))
            if extra:
                archive.addfile(extra)

    def test_restore_reuse_and_detect_changed_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.archive(root / 'libs.tar')
            result = module.restore(root / 'libs.tar', root / 'restored')
            self.assertEqual(result, str((root / 'restored/lib').resolve()))
            self.assertEqual(module.restore(root / 'libs.tar', root / 'restored'), result)
            (root / 'restored/lib/libGL.so.1').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'CACHE_INVALID'):
                module.restore(root / 'libs.tar', root / 'restored')

    def test_reject_links_traversal_and_corruption_before_writing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ['../escape', 'lib/link.so.1']:
                member = tarfile.TarInfo(name)
                member.type = tarfile.SYMTYPE
                member.linkname = '/etc/passwd'
                self.archive(root / 'libs.tar', extra=member)
                with self.assertRaisesRegex(ValueError, 'ARCHIVE_INVALID'):
                    module.restore(root / 'libs.tar', root / 'restored')
                self.assertFalse((root / 'restored').exists())
            self.archive(root / 'libs.tar', corrupt=True)
            with self.assertRaisesRegex(ValueError, 'HASH_MISMATCH'):
                module.restore(root / 'libs.tar', root / 'restored')
            self.assertFalse((root / 'restored').exists())


if __name__ == '__main__':
    unittest.main()
