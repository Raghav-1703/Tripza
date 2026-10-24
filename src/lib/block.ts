import { prisma } from "@/lib/prisma";

export interface BlockRelationship {
  isBlocked: boolean;
  blockedByMe: boolean;
  blockedByThem: boolean;
}

/**
 * Checks whether a bidirectional block exists between two users.
 * Returns true if userA blocked userB OR userB blocked userA.
 */
export async function areUsersBlocked(userAId: string, userBId: string): Promise<boolean> {
  if (!userAId || !userBId || userAId === userBId) {
    return false;
  }

  const block = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: userAId, blockedId: userBId },
        { blockerId: userBId, blockedId: userAId },
      ],
    },
    select: { id: true },
  });

  return !!block;
}

/**
 * Returns all user IDs that have a bidirectional block relationship with the given user.
 * (Users blocked by userId + Users who blocked userId)
 */
export async function getBidirectionalBlockedUserIds(userId: string): Promise<string[]> {
  if (!userId) {
    return [];
  }

  const [blockedByMe, blockedMe] = await Promise.all([
    prisma.block.findMany({
      where: { blockerId: userId },
      select: { blockedId: true },
    }),
    prisma.block.findMany({
      where: { blockedId: userId },
      select: { blockerId: true },
    }),
  ]);

  const idSet = new Set<string>();
  blockedByMe.forEach((b) => idSet.add(b.blockedId));
  blockedMe.forEach((b) => idSet.add(b.blockerId));

  return Array.from(idSet);
}

/**
 * Gets the granular block relationship between current user and a target user.
 */
export async function getBlockRelationship(currentUserId: string, targetUserId: string): Promise<BlockRelationship> {
  if (!currentUserId || !targetUserId || currentUserId === targetUserId) {
    return { isBlocked: false, blockedByMe: false, blockedByThem: false };
  }

  const blocks = await prisma.block.findMany({
    where: {
      OR: [
        { blockerId: currentUserId, blockedId: targetUserId },
        { blockerId: targetUserId, blockedId: currentUserId },
      ],
    },
    select: { blockerId: true, blockedId: true },
  });

  const blockedByMe = blocks.some((b) => b.blockerId === currentUserId && b.blockedId === targetUserId);
  const blockedByThem = blocks.some((b) => b.blockerId === targetUserId && b.blockedId === currentUserId);

  return {
    isBlocked: blockedByMe || blockedByThem,
    blockedByMe,
    blockedByThem,
  };
}

/**
 * Blocks a target user. Validates that users exist and cannot block oneself.
 */
export async function blockUser(blockerId: string, targetUserId: string) {
  if (!blockerId || !targetUserId) {
    throw new Error("Missing user IDs");
  }

  if (blockerId === targetUserId) {
    throw new Error("You cannot block yourself");
  }

  // Ensure target user exists
  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, name: true },
  });

  if (!targetUser) {
    throw new Error("Target user does not exist");
  }

  // Idempotently create block
  try {
    const block = await prisma.block.create({
      data: {
        blockerId,
        blockedId: targetUserId,
      },
      include: {
        blocked: { select: { id: true, name: true, email: true, userType: true } },
      },
    });
    return block;
  } catch (err: unknown) {
    // Check if unique constraint violation (already blocked)
    const errorObj = err as { code?: string };
    if (errorObj?.code === "P2002") {
      const existing = await prisma.block.findUnique({
        where: {
          blockerId_blockedId: {
            blockerId,
            blockedId: targetUserId,
          },
        },
        include: {
          blocked: { select: { id: true, name: true, email: true, userType: true } },
        },
      });
      return existing;
    }
    throw err;
  }
}

/**
 * Unblocks a target user previously blocked by blockerId.
 */
export async function unblockUser(blockerId: string, targetUserId: string) {
  if (!blockerId || !targetUserId) {
    throw new Error("Missing user IDs");
  }

  if (blockerId === targetUserId) {
    throw new Error("Cannot unblock yourself");
  }

  const existing = await prisma.block.findUnique({
    where: {
      blockerId_blockedId: {
        blockerId,
        blockedId: targetUserId,
      },
    },
  });

  if (!existing) {
    return { success: true, message: "User was not blocked" };
  }

  await prisma.block.delete({
    where: {
      blockerId_blockedId: {
        blockerId,
        blockedId: targetUserId,
      },
    },
  });

  return { success: true, message: "User unblocked successfully" };
}
