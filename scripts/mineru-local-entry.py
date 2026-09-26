#!/usr/bin/env python3
"""Local pipeline entry without the stock CLI's temporary HTTP server.

Invoke with the configured MinerU virtualenv Python, using a private executable
launcher if necessary. No provider credentials or external title service needed.
"""
import argparse
import json
import os
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('-p', required=True)
    parser.add_argument('-o', required=True)
    parser.add_argument('-b', required=True, choices=['pipeline'])
    args = parser.parse_args()
    config_path = os.environ.get('MINERU_TOOLS_CONFIG_JSON', '')
    if not config_path or os.environ.get('MINERU_MODEL_SOURCE') != 'local':
        raise RuntimeError('MINERU_LOCAL_MODEL_CONFIG_REQUIRED')
    config = json.loads(Path(config_path).read_text())
    if config.get('model-source') != 'local' or config.get('llm-aided-config', {}).get('title_aided', {}).get('enable') is True:
        raise RuntimeError('MINERU_LOCAL_MODEL_CONFIG_REQUIRED')
    path = Path(args.p)
    size = path.stat().st_size
    if size < 5 or size > 100 * 1024 * 1024:
        raise RuntimeError('MINERU_INPUT_INVALID')
    pdf = path.read_bytes()
    if len(pdf) != size or not pdf.startswith(b'%PDF-'):
        raise RuntimeError('MINERU_INPUT_INVALID')
    os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1')
    from mineru.cli.common import do_parse
    do_parse(args.o, [path.stem], [pdf], ['en'], backend='pipeline',
             parse_method='auto', formula_enable=True, table_enable=True)


if __name__ == '__main__':
    main()
