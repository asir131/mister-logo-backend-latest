const Post = require("../models/Post");
const { resolveAccountsForUser } = require("./outstandAccounts");
const outstandApi = require("./outstandApi");

function normalizeTargets(post) {
  const targets = new Set();
  if (Array.isArray(post.shareTargets)) {
    post.shareTargets.forEach((target) => targets.add(String(target)));
  }
  // Backward-compatible flags
  if (post.shareToFacebook) targets.add("facebook");
  if (post.shareToInstagram) targets.add("instagram");
  return Array.from(targets);
}

async function enqueuePostShare(post) {
  if (!post) return;
  const targets = normalizeTargets(post);
  if (targets.length === 0) return;

  setImmediate(() => {
    console.log(
      `Queued post ${post._id} for Outstand share: ${targets.join(", ")}`,
    );
  });

  try {
    const { accountIds, missing } = await resolveAccountsForUser(
      post.userId,
      targets,
    );
    if (missing.length) {
      const update = {};
      missing.forEach((platform) => {
        update[`shareStatus.${platform}`] = {
          status: "failed",
          error: "Platform account not connected.",
          updatedAt: new Date(),
        };
      });
      await Post.updateOne({ _id: post._id }, { $set: update });
    }
    if (accountIds.length === 0) return;

    const outstandPost = await outstandApi.createPost({
      content: post.description || "",
      mediaUrls: [post.mediaUrl],
      accounts: accountIds,
    });
    await Post.updateOne(
      { _id: post._id },
      {
        $set: {
          latePostId: outstandPost.id || outstandPost.postId,
        },
      },
    );
  } catch (err) {
    console.error("Outstand share error:", {
      message: err.message,
      status: err.status,
      payload: err.payload,
      url: err.url,
      method: err.method,
      requestBody: err.requestBody,
    });
    const update = {};
    const incs = {};
    targets.forEach((platform) => {
      update[`shareStatus.${platform}`] = {
        status: "failed",
        error: err.message,
        updatedAt: new Date(),
      };
      incs[`attempts.${platform}`] = 1;
    });
    const ops = { $set: update };
    if (Object.keys(incs).length) {
      ops.$inc = incs;
    }
    await Post.updateOne({ _id: post._id }, ops);
  }
}

module.exports = {
  enqueuePostShare,
};
