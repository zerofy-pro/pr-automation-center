const { 
  GITHUB_TOKEN, JIRA_TOKEN, JIRA_USER, JIRA_DOMAIN, 
  PR_NUMBER, REPO_FULL_NAME, PR_BODY_INPUT
} = process.env;

// Fallbacks to prevent bash undefined errors
const PR_TITLE = process.env.PR_TITLE || "";
const BRANCH_NAME = process.env.BRANCH_NAME || "";
const PR_BODY = PR_BODY_INPUT || "";

const JIRA_MARKER_START = "<!-- JIRA-INFO-START -->";
const JIRA_MARKER_END = "<!-- JIRA-INFO-END -->";

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

  // 3. Fetch Jira Titles (Strict Mode)
  // Initialize Markdown Table Header
  let jiraList = "> | Ticket | Type | Status | Summary |\n> |:---:|:---:|:---:|:---|\n";
  let validTicketCount = 0; 
  
  const authHeader = `Basic ${Buffer.from(`${JIRA_USER}:${JIRA_TOKEN}`).toString('base64')}`;

  for (const key of keys) {
    console.log(`Checking Jira for ticket: ${key}...`);
    try {
      const res = await fetch(`https://${JIRA_DOMAIN}/rest/api/3/issue/${key}`, {
        headers: { 'Authorization': authHeader, 'Accept': 'application/json' }
      });
      
      if (res.ok) {
        const data = await res.json();
        const f = data.fields;
        const status = f.status ? f.status.name.toUpperCase() : "UNKNOWN";
        const type = f.issuetype ? f.issuetype.name : "Task";
        const summary = (f.summary || "No Summary").replace(/\|/g, '-'); // Escape pipes for table

        jiraList += `> | [${key}](https://${JIRA_DOMAIN}/browse/${key}) | ${type} | ${status} | ${summary} |\n`;
        console.log(`✅ Validated real Jira ticket: ${key}`);
        validTicketCount++;
      } else {
        console.error(`⚠️ Jira returned HTTP ${res.status} for ${key}. Ticket might not exist or lacks permissions.`);
      }
    } catch (e) {
      console.error(`❌ Error connecting to Jira for ${key}:`, e.message);
    }
  }

  // If we checked all the keys and NONE of them were real, fail the CI.
  if (validTicketCount === 0) {
    console.error("❌ STRICT FAILURE: Could not validate ANY of the provided Jira tickets. Ensure the ticket actually exists!");
    process.exit(1); 
  }

  // 4. Update PR Description (Optional)
  if (process.env.SKIP_UPDATE === 'true') {
    console.log("ℹ️ Skipping PR description update as per configuration.");
    return;
  }

  const infoBlock = `${JIRA_MARKER_START}\n>[!NOTE]\n>### 🎫 Related Jira Tickets\n${jiraList}${JIRA_MARKER_END}`;
  let newBody = "";

  if (PR_BODY.includes(JIRA_MARKER_START)) {
    // Replace existing block
    const replaceRegex = new RegExp(`${JIRA_MARKER_START}[\\s\\S]*?${JIRA_MARKER_END}`);
    newBody = PR_BODY.replace(replaceRegex, infoBlock);
  } else {
    // Append block at the top, preserving original description
    newBody = `${infoBlock}\n\n${PR_BODY}`;
  }

  if (newBody !== PR_BODY) {
    console.log("Updating PR description with verified Jira details...");
    const patchRes = await fetch(`https://api.github.com/repos/${REPO_FULL_NAME}/pulls/${PR_NUMBER}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ body: newBody })
    });
    
    if (!patchRes.ok) {
      console.error(`⚠️ Failed to update PR description: HTTP ${patchRes.status}`);
    }
  }
  
  console.log("✅ All PR standards met successfully!");
}

run().catch(err => { 
  console.error("❌ An unexpected error occurred:", err); 
  process.exit(1); 
});
