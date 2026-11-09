"""Run mocked browser regressions and expose concise CI failure diagnostics."""
import os
import subprocess
import sys

for script in ['research-browser.py', 'pagination-browser.py', 'password-recovery-browser.py']:
    result = subprocess.run([sys.executable, 'tests/' + script], capture_output=True, text=True)
    print(result.stdout)
    print(result.stderr, file=sys.stderr)
    if result.returncode:
        failure = script + ': ' + ' '.join((result.stderr or result.stdout).split())[-700:]
        if os.environ.get('GITHUB_OUTPUT'):
            with open(os.environ['GITHUB_OUTPUT'], 'a') as handle:
                handle.write('failure=' + failure + '\n')
        sys.exit(result.returncode)
