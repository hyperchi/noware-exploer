"""Rebuild the quarter source asset. No third-party Python packages required."""
from pathlib import Path
from urllib.request import urlretrieve
url = 'https://upload.wikimedia.org/wikipedia/commons/a/a0/2006_Quarter_Proof.png'
output = Path(__file__).resolve().parents[2] / 'public/showcase/scale/quarter.png'
output.parent.mkdir(parents=True, exist_ok=True)
urlretrieve(url, output)
print(output)
