import hashlib
import importlib.util
import io
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch


SOURCE = Path(__file__).resolve().parents[2] / 'server/runtime-assets/mineru/restore-python-runtime.py'
spec = importlib.util.spec_from_file_location('restore_python_runtime', SOURCE)
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


def archive(entries):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w:gz') as result:
        for name, kind, value in entries:
            member = tarfile.TarInfo(name)
            if kind == 'file':
                data = value
                member.size = len(data)
                member.mode = 0o755 if name.endswith('python3.10') else 0o644
                result.addfile(member, io.BytesIO(data))
            elif kind == 'symlink':
                member.type = tarfile.SYMTYPE
                member.linkname = value
                result.addfile(member)
            elif kind == 'hardlink':
                member.type = tarfile.LNKTYPE
                member.linkname = value
                result.addfile(member)
            elif kind == 'device':
                member.type = tarfile.CHRTYPE
                member.devmajor = 1
                member.devminor = 3
                result.addfile(member)
            elif kind == 'directory':
                member.type = tarfile.DIRTYPE
                result.addfile(member)
            else:
                raise AssertionError(kind)
    return stream.getvalue()


class PythonRuntimeRestoreTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name) / 'home'
        self.payload = b'linux-cpython-3.10-placeholder'

    def write_archive(self, entries):
        path = Path(self.directory.name) / 'python.tar.gz'
        path.write_bytes(archive(entries))
        return path

    @staticmethod
    def fake_inspect(python_root):
        return python_root / 'bin' / 'python3.10'

    def valid_entries(self):
        return [
            ('python/bin/python3.10', 'file', self.payload),
            ('python/bin/python', 'symlink', 'python3.10'),
            ('python/lib/libpython3.10.so', 'symlink', 'libpython3.10.so.1.0'),
            ('python/lib/libpython3.10.so.1.0', 'file', b'library'),
        ]

    def test_valid_internal_symlinks_publish_atomically_and_reuse(self):
        path = self.write_archive([('python/', 'directory', None), *self.valid_entries()])
        with patch.object(runtime, 'inspect_interpreter', side_effect=self.fake_inspect):
            executable, reused = runtime.restore(path, self.root,
                                                  hashlib.sha256(path.read_bytes()).hexdigest())
            self.assertFalse(reused)
            self.assertEqual(executable, (self.root / 'python/bin/python3.10').resolve())
            executable, reused = runtime.restore(path, self.root)
        self.assertTrue(reused)
        self.assertEqual(executable, (self.root / 'python/bin/python3.10').resolve())
        self.assertTrue((self.root / 'python/bin/python').is_symlink())
        self.assertFalse(list(self.root.glob('.python-runtime-*')))

    def test_sha_mismatch_does_not_create_runtime(self):
        path = self.write_archive(self.valid_entries())
        with self.assertRaisesRegex(runtime.RuntimeRestoreError, 'MINERU_PYTHON_ARCHIVE_SHA256_MISMATCH'):
            runtime.restore(path, self.root, '0' * 64)
        self.assertFalse((self.root / 'python').exists())

    def test_symlink_escape_is_rejected_without_publishing(self):
        path = self.write_archive([
            ('python/bin/python3.10', 'file', self.payload),
            ('python/bin/escape', 'symlink', '../../outside'),
        ])
        with self.assertRaisesRegex(runtime.RuntimeRestoreError, 'MINERU_PYTHON_ARCHIVE_SYMLINK_ESCAPE'):
            with patch.object(runtime, 'inspect_interpreter', side_effect=self.fake_inspect):
                runtime.restore(path, self.root)
        self.assertFalse((self.root / 'python').exists())
        self.assertFalse((self.root / 'outside').exists())

    def test_absolute_path_hardlink_and_device_are_rejected(self):
        cases = [
            ([('/outside', 'file', b'x')], 'MINERU_PYTHON_ARCHIVE_PATH_INVALID'),
            ([('python/bin/python3.10', 'file', self.payload),
              ('python/bin/alias', 'hardlink', 'python/bin/python3.10')],
             'MINERU_PYTHON_ARCHIVE_HARDLINK_FORBIDDEN'),
            ([('python/bin/python3.10', 'file', self.payload),
              ('python/dev', 'device', None)],
             'MINERU_PYTHON_ARCHIVE_SPECIAL_FILE_FORBIDDEN'),
        ]
        for entries, error in cases:
            with self.subTest(error=error):
                path = self.write_archive(entries)
                with self.assertRaisesRegex(runtime.RuntimeRestoreError, error):
                    with patch.object(runtime, 'inspect_interpreter', side_effect=self.fake_inspect):
                        runtime.restore(path, self.root)
                self.assertFalse((self.root / 'python').exists())

    def test_existing_hardlink_is_not_reused(self):
        target = self.root / 'python'
        (target / 'bin').mkdir(parents=True)
        executable = target / 'bin/python3.10'
        executable.write_bytes(self.payload)
        alias = target / 'bin/alias'
        os.link(executable, alias)
        path = self.write_archive(self.valid_entries())
        with self.assertRaisesRegex(runtime.RuntimeRestoreError, 'MINERU_PYTHON_RUNTIME_HARDLINK_FORBIDDEN'):
            with patch.object(runtime, 'inspect_interpreter', side_effect=self.fake_inspect):
                runtime.restore(path, self.root)


if __name__ == '__main__':
    unittest.main()
