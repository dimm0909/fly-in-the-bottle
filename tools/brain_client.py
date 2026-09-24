"""Drive the brain sidecar from Python (exploration and tests). Same protocol as the widget uses."""
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent.parent


class Brain:
    def __init__(self, backend='cpu', groups=None, binary=None):
        cmd = [str(binary or ROOT / 'data/brain/brain'), '--graph', str(ROOT / 'data/brain/graph.bin'),
               '--groups', str(groups or ROOT / 'data/brain/groups.txt'), '--backend', backend]
        self.p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
        ready = self.p.stdout.readline().split()
        assert ready[0] == 'READY', ready
        self.backend, self.n, self.e = ready[1], int(ready[2]), int(ready[3])
        parts = self._cmd('groups').split()
        k = int(parts[1])
        self.names = parts[2::2][:k]
        self.sizes = dict(zip(self.names, map(int, parts[3::2][:k])))

    def _cmd(self, line):
        self.p.stdin.write(line + '\n')
        self.p.stdin.flush()
        return self.p.stdout.readline().strip()

    def drive(self, group, mv):
        assert self._cmd(f'drive {group} {mv}') == 'OK'

    def poisson(self, group, hz):
        assert self._cmd(f'poisson {group} {hz}') == 'OK'

    def param(self, name, value):
        assert self._cmd(f'param {name} {value}') == 'OK'

    def cutout(self, group):
        assert self._cmd(f'cutout {group}') == 'OK'

    def clear(self):
        self._cmd('clear')

    def reset(self):
        self._cmd('reset')

    def advance(self, ms):
        """Run `ms` and return spike counts per group."""
        parts = self._cmd(f'advance {ms}').split()
        assert parts[0] == 'R', parts
        return dict(zip(self.names, map(int, parts[2:])))

    def rates(self, ms):
        """Mean firing rate per neuron (Hz) per group over the next `ms`."""
        c = self.advance(ms)
        return {k: c[k] / self.sizes[k] / (ms / 1000.0) for k in c}

    def bench(self, ms):
        return self._cmd(f'bench {ms}')

    def close(self):
        try:
            self.p.stdin.write('quit\n'); self.p.stdin.flush()
        except Exception:
            pass
        self.p.wait(timeout=5)


def show(rates, minimum=0.5, prefix=None):
    rows = [(k, v) for k, v in rates.items() if v >= minimum and (prefix is None or k.startswith(prefix))]
    return '  '.join(f'{k}={v:.1f}' for k, v in sorted(rows))
