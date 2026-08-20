import { notFound } from "next/navigation";
import {
  PROTOTYPE_PILOT_AGGREGATE_SCHEMA_VERSION,
  buildPrototypePilotPackets,
  findPrototypePilotPacket,
  orderPrototypePilotPacket,
  prototypePilotAggregateFilename,
} from "@/items/prototype-pilot";
import { PrototypePilot, PrototypePilotPacketPicker } from "./prototype-pilot";

export const dynamic = "force-dynamic";

/** Development/pilot surface; never part of the normal scored test. */
export default async function PrototypePage({
  searchParams,
}: {
  searchParams: Promise<{ packet?: string; session?: string }>;
}) {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_SCENE_PROTOTYPES !== "1") {
    notFound();
  }

  const { packet: packetId, session } = await searchParams;
  const packets = buildPrototypePilotPackets();
  const packet = packetId ? findPrototypePilotPacket(packetId) : undefined;
  // A named packet with no session label is a missing label, not a bad packet —
  // reporting it as "invalid packet" sends the pilot operator hunting the wrong thing.
  if (!packet) return <PrototypePilotPacketPicker packets={packets} invalidPacket={Boolean(packetId)} />;
  if (!session) return <PrototypePilotPacketPicker packets={packets} invalidPacket={false} missingSession />;

  try {
    return (
      <PrototypePilot
        items={orderPrototypePilotPacket(packet, session)}
        packetId={packet.packetId}
        packetContentFingerprint={packet.contentFingerprint}
        aggregateSchemaVersion={PROTOTYPE_PILOT_AGGREGATE_SCHEMA_VERSION}
        exportFilename={prototypePilotAggregateFilename(packet.packetId)}
      />
    );
  } catch {
    return <PrototypePilotPacketPicker packets={packets} invalidPacket={false} invalidSession />;
  }
}
