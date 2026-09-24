import sys, time
sys.path.insert(0, 'tools')
from brain_client import Brain, show
b = Brain()
print('backend', b.backend, b.n, 'neurons', b.e, 'edges')
print('idle 300ms:', show(b.rates(300)) or '(silent)')
# ambient light on both eyes
for s in 'LR': b.drive(f'pr_{s}', 9.0)
b.advance(300)                       # settle
r = b.rates(400)
print('\nAMBIENT LIGHT (pr drive 9mV)   mn/dn groups active:')
print('  ', show(r, 0.5, 'mn_'), '\n  ', show(r, 0.5, 'dn'))
# looming on the right eye
b.drive('looming_R', 12.0)
b.advance(100)
r = b.rates(300)
print('\nLOOMING right (looming_R drive 12):')
print('  ', show(r, 0.5, 'mn_'), '\n  ', show(r, 0.5, 'dn'))
b.close()
