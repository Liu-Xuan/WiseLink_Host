import hashlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SOURCE = Path(__file__).resolve().parents[2] / 'server/runtime-assets/mineru/prepare-models.py'
spec = importlib.util.spec_from_file_location('prepare_models', SOURCE)
models = importlib.util.module_from_spec(spec)
spec.loader.exec_module(models)


class Response(io.BytesIO):
    status = 206

    def __init__(self, data, content_range):
        super().__init__(data)
        self.headers = {'Content-Range': content_range}


class ModelPreparationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name).resolve()
        self.data = b'abcdefghijklmn'
        self.entry = {'kind': 'pipeline', 'path': 'models/test.bin',
                      'bytes': len(self.data), 'sha256': hashlib.sha256(self.data).hexdigest()}
        self.repos = {'pipeline': {'modelscope': 'OpenDataLab/example'}}

    def prepare(self):
        models.prepare_file(self.root, self.entry, self.repos, 'modelscope', False)

    def test_resume_discards_incomplete_chunk_and_verifies_complete_bytes(self):
        target = models.model_path(self.root, self.entry)
        target.parent.mkdir(parents=True)
        target.with_name('test.bin.download').write_bytes(self.data[:4] + b'xx')
        ranges = []

        def fetch(request, timeout):
            start, end = map(int, request.get_header('Range').removeprefix('bytes=').split('-'))
            ranges.append((start, end))
            return Response(self.data[start:end + 1], f'bytes {start}-{end}/{len(self.data)}')

        with patch.object(models, 'CHUNK', 4), patch.object(models.urllib.request, 'urlopen', fetch):
            self.prepare()
        self.assertEqual(ranges, [(4, 7), (8, 11), (12, 13)])
        self.assertEqual(target.read_bytes(), self.data)
        self.assertFalse(target.with_name('test.bin.download').exists())

    def test_wrong_range_is_rejected_without_publishing(self):
        with patch.object(models.urllib.request, 'urlopen', side_effect=lambda *a, **kw: Response(self.data, 'bytes 1-14/15')), patch.object(models.time, 'sleep'):
            with self.assertRaisesRegex(ValueError, 'unexpected byte range'):
                self.prepare()
        self.assertFalse(models.model_path(self.root, self.entry).exists())

    def test_existing_verified_file_is_reused_and_corruption_is_not_overwritten(self):
        target = models.model_path(self.root, self.entry)
        target.parent.mkdir(parents=True)
        target.write_bytes(self.data)
        with patch.object(models.urllib.request, 'urlopen') as fetch:
            self.prepare()
            fetch.assert_not_called()
        target.write_bytes(b'x' * len(self.data))
        with self.assertRaisesRegex(ValueError, 'Existing model checksum mismatch'):
            self.prepare()
        self.assertEqual(target.read_bytes(), b'x' * len(self.data))


if __name__ == '__main__':
    unittest.main()
