import { prisma } from "@/lib/prisma";
import { DEFAULT_TAGS } from "@/lib/constants";

export async function ensureUserDefaults(userId: string) {
  await prisma.$transaction(async (tx) => {
    for (const name of DEFAULT_TAGS) {
      await tx.tag.upsert({
        where: { userId_name: { userId, name } },
        update: {},
        create: { userId, name, isDefault: true }
      });
    }

    await tx.userSettings.upsert({
      where: { userId },
      update: {},
      create: { userId }
    });
  });
}
