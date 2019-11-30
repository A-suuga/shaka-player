
import compiler
import generateLocalizations
import shakaBuildHelpers

import os
import re

def compile_less(path_name, main_file_name):
  match = re.compile(r'.*\.less$')
  base = shakaBuildHelpers.get_source_base()
  main_less_src = os.path.join(base, path_name, main_file_name + '.less')
  all_less_srcs = shakaBuildHelpers.get_all_files(
      os.path.join(base, path_name), match)
  output = os.path.join(base, 'dist', main_file_name + '.css')

  less = compiler.Less(main_less_src, all_less_srcs, output)
  return less.compile(False)

def main(args):
  # Make the dist/ folder, ignore errors.
  base = shakaBuildHelpers.get_source_base()
  try:
    os.mkdir(os.path.join(base, 'dist'))
  except OSError:
    pass

  localizations = compiler.GenerateLocalizations(generateLocalizations.DEFAULT_LOCALES)
  if not localizations.generate(False):
    return 1

  if not compile_less('ui', 'controls'):
    return 1;

  return 0

if __name__ == '__main__':
  shakaBuildHelpers.run_main(main)
