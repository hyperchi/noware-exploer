// Find the AirCube on the USB bus. Every cube enumerates as the ESP32-H2's
// built-in USB Serial/JTAG, vendor 303A product 1001.
export const AIRCUBE_VENDOR_ID = "303a";
export const AIRCUBE_PRODUCT_ID = "1001";

const hex = (v) => String(v || "").toLowerCase().replace(/^0x/, "").padStart(4, "0");

/** Pick the AirCube from a SerialPort.list() result. Pure, for tests. */
export function pickAirCube(ports, { preferred = "", platform = process.platform } = {}) {
  if (preferred) return { path: preferred, serialNumber: "", matched: "override" };
  const cubes = (ports || []).filter((p) => hex(p.vendorId) === AIRCUBE_VENDOR_ID && hex(p.productId) === AIRCUBE_PRODUCT_ID);
  if (!cubes.length) return null;
  const port = cubes[0];
  // macOS lists /dev/tty.*; the call-out device does not wait for carrier.
  const path = platform === "darwin" ? port.path.replace("/dev/tty.", "/dev/cu.") : port.path;
  return { path, serialNumber: port.serialNumber || "", matched: "usb-id", candidates: cubes.length };
}

export async function discoverAirCube({ preferred = "", list } = {}) {
  if (!list) ({ SerialPort: { list } } = await import("serialport"));
  const ports = preferred ? [] : await list();
  return pickAirCube(ports, { preferred });
}
