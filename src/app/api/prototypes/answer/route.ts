import { NextResponse } from "next/server";
import { z } from "zod";
import { gradePrototypePilotAnswer } from "@/items/prototype-pilot";

const RequestSchema = z.object({
  itemId: z.string().min(1).max(100),
  selectedOption: z.number().int().min(0).max(5),
}).strict();

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_SCENE_PROTOTYPES !== "1") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const body = RequestSchema.parse(await request.json());
    return NextResponse.json(gradePrototypePilotAnswer(body.itemId, body.selectedOption));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid pilot answer" },
      { status: 400 },
    );
  }
}
