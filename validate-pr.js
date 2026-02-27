const { 
  GITHUB_TOKEN, JIRA_TOKEN, JIRA_DOMAIN, 
  PR_NUMBER, REPO_FULL_NAME, PR_TITLE, BRANCH_NAME, PR_BODY_INPUT 
} = process.env;

const PR_BODY = PR_BODY_INPUT || "";
const JIRA_MARKER_START = "";
const JIRA_MARKER_END = "";

async function run() {
  console.log(`Checking PR #${PR_NUMBER} in ${REPO_FULL_NAME}...`);

  // 1. Extract Jira Keys
  const jiraRegex = /([A-Z]+-\d+)/g;
  const keys = new Set([
    ...(PR_TITLE.match(jiraRegex) || []),
    ...(BRANCH_NAME.match(jiraRegex) || [])
  ]);

  if (keys.size === 0) {
    console.error("❌ No Jira ticket key found in title or branch name.");
    process.exit(1);
  }

  // 2. Validate Description Length (10 chars rule)
  const cleanTitle = PR_TITLE.replace(jiraRegex, '').replace(/[\[\]\(\)]/g, '').trim();
  if (cleanTitle.length < 10) {
    console.error(`❌ PR Title description is too short (${cleanTitle.length} chars). Must be at least 10.`);
    process.exit(1);
  }

  // 3. Fetch Jira Titles
  let jiraList = "";
  const authHeader = `Bearer ${JIRA_TOKEN}`;

  for (const key of keys) {
    try {
      const res = await fetch(`https://${JIRA_DOMAIN}/rest/api/3/issue/${key}`, {
        headers: { 'Authorization': authHeader, 'Accept': 'application/json' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      jiraList += `* [${key}](https://${JIRA_DOMAIN}/browse/${key}) - ${data.fields.summary}\n`;
      console.log(`✅ Found Jira ticket: ${key}`);
    } catch (e) {
      jiraList += `* ${key} (Could not fetch title from Jira)\n`;
      console.log(`⚠️ Could not fetch data for ${key}`);
    }
  }

  // 4. Update PR Description (Non-destructive)
  const infoBlock = `${JIRA_MARKER_START}\n### 🎫 Related Jira Tickets\n${jiraList}${JIRA_MARKER_END}`;
  let newBody = "";

  if (PR_BODY.includes(JIRA_MARKER_START)) {
    // Replace existing block to keep it up-to-date
    const replaceRegex = new RegExp(`${JIRA_MARKER_START}[\\s\\S]*${JIRA_MARKER_END}`);
    newBody = PR_BODY.replace(replaceRegex, infoBlock);
  } else {
    // Prepend to existing description
    newBody = `${infoBlock}\n\n${PR_BODY}`;
  }

  if (newBody !== PR_BODY) {
    console.log("Updating PR description with Jira details...");
    await fetch(`https://api.github.com/repos/${REPO_FULL_NAME}/pulls/${PR_NUMBER}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ body: newBody })
    });
  }
  
  console.log("✅ All PR standards met!");
}

run().catch(err => { 
  console.error("❌ An unexpected error occurred:", err); 
  process.exit(1); 
});