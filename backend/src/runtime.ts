export type SetarehTransport = "stdio" | "http" | "both";

export function resolveTransport(rawValue: string | undefined, port: number | undefined): SetarehTransport {
  const value = rawValue?.trim().toLowerCase();
  const transport = value || (port ? "both" : "stdio");
  if (transport !== "stdio" && transport !== "http" && transport !== "both") {
    throw new Error("SETAREH_TRANSPORT must be stdio, http or both.");
  }
  if ((transport === "http" || transport === "both") && !port) {
    throw new Error("PORT is required when SETAREH_TRANSPORT includes http.");
  }
  return transport;
}
