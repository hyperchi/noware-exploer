"""Reuse the project's KiCad parser without modifying the playground's board data."""
import pathlib,sys
root=pathlib.Path(__file__).resolve().parents[2]
source=(root/'scripts/extract.py').read_text()
source=source.replace("(root/'public/source/AirCube.kicad_pcb')", "pathlib.Path(sys.argv[1])").replace("(root/'public/board.json')", "(root/'public/showcase/board.json')")
source=source.replace('bd857275c1f02efbec6942a96e433bde9d4d417e','2135e5bc3ff6f6542cf9e252a7453c81917ff706')
source=source.replace('root=pathlib.Path(__file__).resolve().parents[1]', 'root=pathlib.Path(__file__).resolve().parents[2]')
exec(compile(source, str(root/'scripts/extract.py'),'exec'))
