"""Read-only deployment audit. --process-demo runs the server's built-in demo STT.

Uses no personal recordings and does not save or delete server records.
"""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default='https://voices-of-the-north.onrender.com')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--process-demo', action='store_true')
    args = parser.parse_args()
    report = {'checked_at_utc': datetime.now(timezone.utc).isoformat(),
              'base_url': args.base, 'checks': []}
    targets = [('/', 'GET'), ('/api/health', 'GET'), ('/openapi.json', 'GET'),
               ('/voices-of-the-north-app.html', 'GET'),
               ('/assets/demo-story.m4a', 'HEAD'),
               ('/assets/interview-story.mp4', 'HEAD'),
               ('/lib/storyCorpus.js', 'HEAD'),
               ('/stories.html?t=0', 'GET'), ('/recording.html', 'GET')]
    if args.process_demo:
        targets.append(('/api/process', 'POST'))
    for path, method in targets:
        check = {'path': path, 'method': method}
        request = Request(args.base.rstrip('/') + path, method=method,
                          data=b'' if method == 'POST' else None)
        try:
            with urlopen(request, timeout=55) as response:
                body = response.read()
                check.update(status=response.status, final_url=response.url,
                             content_type=response.headers.get('Content-Type'))
                if 'application/json' in (check['content_type'] or ''):
                    data = json.loads(body)
                    if path == '/openapi.json':
                        check['routes'] = {p: list(ops) for p, ops in data['paths'].items()}
                    else:
                        check['response'] = data
                elif path.endswith('.html'):
                    local = (ROOT / 'frontend' / 'voices-of-the-north-app.html').read_bytes()
                    check.update(bytes=len(body), sha256=hashlib.sha256(body).hexdigest(),
                                 local_sha256=hashlib.sha256(local).hexdigest(),
                                 matches_local=body == local,
                                 matches_local_normalized=body.decode('utf-8').replace('\r\n', '\n') ==
                                 local.decode('utf-8').replace('\r\n', '\n'))
                    args.output.parent.mkdir(parents=True, exist_ok=True)
                    (args.output.parent / 'deployed-app.html').write_bytes(body)
        except HTTPError as error:
            check.update(status=error.code, error=error.read(2000).decode('utf-8', errors='replace'))
        except (URLError, TimeoutError, OSError) as error:
            check['error'] = str(error)
        report['checks'].append(check)
        print(json.dumps(check, ensure_ascii=True), flush=True)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
