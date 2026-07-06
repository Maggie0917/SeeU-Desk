import { prisma } from "@/lib/prisma";
import { DEFAULT_TAGS } from "@/lib/constants";

export async function ensureUserDefaults(userId: string) {
  await prisma.tag.createMany({
    data: DEFAULT_TAGS.map((name) => ({ userId, name, isDefault: true })),
    skipDuplicates: true
  });

  await prisma.userSettings.upsert({
    where: { userId },
    update: {},
    create: { userId }
  });
}
