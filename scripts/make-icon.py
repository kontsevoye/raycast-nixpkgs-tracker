"""Render an SVG icon using the attributed Nix snowflake and a PR badge.

Requires ImageMagick with librsvg support (`magick`).
Upstream artwork and its CC BY 4.0 license are in assets/upstream/.
"""

from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", NS)
upstream = ET.parse(ROOT / "assets/upstream/nix-snowflake.svg").getroot()
icon = ET.Element(f"{{{NS}}}svg", {
    "width": "512", "height": "512", "viewBox": "0 0 512 512",
    "role": "img", "aria-label": "Nix snowflake with a green pull request badge",
})
ET.SubElement(icon, f"{{{NS}}}title").text = "NixPkgs PR Tracker"
ET.SubElement(icon, f"{{{NS}}}desc").text = (
    "Adapted from Nix Snowflake by Simon Frankau and Tim Cuthbertson, "
    "NixOS Project, CC BY 4.0. Added a rounded background and pull request badge."
)
ET.SubElement(icon, f"{{{NS}}}rect", {"x": "8", "y": "8", "width": "496", "height": "496", "rx": "108", "fill": "#142137"})
ET.SubElement(icon, f"{{{NS}}}rect", {"x": "9", "y": "9", "width": "494", "height": "494", "rx": "107", "fill": "none", "stroke": "#ffffff", "stroke-opacity": ".07", "stroke-width": "2"})
upstream.set("x", "49")
upstream.set("y", "42")
upstream.set("width", "383")
upstream.set("height", "383")
icon.append(upstream)
ET.SubElement(icon, f"{{{NS}}}circle", {"cx": "391", "cy": "388", "r": "100", "fill": "#142137"})
ET.SubElement(icon, f"{{{NS}}}circle", {"cx": "391", "cy": "388", "r": "83", "fill": "#39c58e"})
ET.SubElement(icon, f"{{{NS}}}path", {
    "d": "M369 354 V422 M409 354 V375 Q409 391 389 395 L369 400",
    "fill": "none", "stroke": "#102b2a", "stroke-width": "12", "stroke-linecap": "round", "stroke-linejoin": "round",
})
for x, y in [(369, 354), (369, 422), (409, 354)]:
    ET.SubElement(icon, f"{{{NS}}}circle", {"cx": str(x), "cy": str(y), "r": "10", "fill": "#39c58e", "stroke": "#102b2a", "stroke-width": "7"})

svg = ROOT / "assets/nixpkgs-tracker.svg"
ET.indent(icon, space="  ")
ET.ElementTree(icon).write(svg, encoding="unicode", xml_declaration=True)
subprocess.run(["magick", "-background", "none", "-density", "192", str(svg), "-resize", "512x512", "PNG32:" + str(ROOT / "assets/nixpkgs-tracker.png")], check=True)
