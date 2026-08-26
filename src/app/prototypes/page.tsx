import { notFound } from "next/navigation";
import {
  PROTOTYPE_PILOT_AGGREGATE_SCHEMA_VERSION,
  PROTOTYPE_PILOT_PACKET_SCHEMA_VERSION,
  PROTOTYPE_PILOT_TIME_BIN_SECONDS,
  buildPrototypePilotPackets,
  findPrototypePilotPacket,
  openPrototypePilotSitting,
  orderPrototypePilotPacket,
  prototypePilotAggregateFilename,
  type PrototypePilotQuestion,
} from "@/items/prototype-pilot";
import { PrototypePilot, PrototypePilotPacketPicker } from "./prototype-pilot";

/**
 * A throwaway label for a sitting nobody named. It only seeds the item-order
 * rotation, so it needs to differ between sittings, not to be unguessable.
 */
function generatedSessionLabel(): string {
  return `session-${Math.random().toString(36).slice(2, 8)}`;
}

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
  // The label only rotates item order and is never exported, so an empty one is
  // no reason to refuse the sitting: generate one. Starting the packet must
  // never depend on a field the page itself describes as inconsequential.
  const sessionLabel = session?.trim() ? session : generatedSessionLabel();

  let orderedItems: PrototypePilotQuestion[];
  try {
    orderedItems = orderPrototypePilotPacket(packet, sessionLabel);
  } catch {
    return <PrototypePilotPacketPicker packets={packets} invalidPacket={false} invalidSession />;
  }

  // Loading the page IS starting a sitting: the server freezes this exact
  // packet, answers included, and from here on grades against that copy. Two
  // participants on one laptop get two sittings because each of them loads the
  // page. Anything wrong with the freeze is left to throw — a sitting that
  // cannot agree with its own answer key must fail loudly, not quietly serve.
  const sitting = openPrototypePilotSitting(packet, orderedItems);
  return (
    <PrototypePilot
      items={sitting.items}
      sittingId={sitting.sittingId}
      packetId={packet.packetId}
      packetContentFingerprint={packet.contentFingerprint}
      packetSchemaVersion={PROTOTYPE_PILOT_PACKET_SCHEMA_VERSION}
      aggregateSchemaVersion={PROTOTYPE_PILOT_AGGREGATE_SCHEMA_VERSION}
      timeBinSeconds={PROTOTYPE_PILOT_TIME_BIN_SECONDS}
      exportFilename={prototypePilotAggregateFilename(packet.packetId)}
    />
  );
}
