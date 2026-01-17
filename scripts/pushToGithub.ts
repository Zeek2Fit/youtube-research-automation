// GitHub Push Script for TubeAutomator
// Uses Replit's GitHub integration to push the project to a repository

import { Octokit } from '@octokit/rest';
import * as fs from 'fs';
import * as path from 'path';

let connectionSettings: any;

async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }
  
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=github',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('GitHub not connected');
  }
  return accessToken;
}

async function getUncachableGitHubClient() {
  const accessToken = await getAccessToken();
  return new Octokit({ auth: accessToken });
}

// Files/directories to exclude from pushing
const EXCLUDED_PATTERNS = [
  'node_modules',
  '.git',
  '.cache',
  '.config',
  'dist',
  '.replit',
  'replit.nix',
  '.upm',
  '.breakpoints',
  'generated-icon.png',
  'tmp',
  '/tmp',
  'drizzle',
  '*.log',
  '.env',
  'docs/',
  '.mastra',
  'package-lock.json',
  'snippets/',
];

function shouldExclude(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return EXCLUDED_PATTERNS.some(pattern => {
    if (pattern.includes('*')) {
      const regex = new RegExp(pattern.replace('*', '.*'));
      return regex.test(normalized);
    }
    return normalized.includes(pattern) || normalized.startsWith(pattern);
  });
}

function getAllFiles(dirPath: string, basePath: string = ''): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = [];
  
  try {
    const items = fs.readdirSync(dirPath);
    
    for (const item of items) {
      const fullPath = path.join(dirPath, item);
      const relativePath = basePath ? `${basePath}/${item}` : item;
      
      if (shouldExclude(relativePath)) {
        continue;
      }
      
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        files.push(...getAllFiles(fullPath, relativePath));
      } else if (stat.isFile()) {
        try {
          const content = fs.readFileSync(fullPath);
          // Check if file is binary
          const isBinary = content.includes(0x00);
          if (!isBinary) {
            files.push({
              path: relativePath,
              content: content.toString('base64')
            });
          }
        } catch (e) {
          console.log(`Skipping file ${relativePath}: ${e}`);
        }
      }
    }
  } catch (e) {
    console.error(`Error reading directory ${dirPath}: ${e}`);
  }
  
  return files;
}

async function createOrUpdateRepo(octokit: Octokit, repoName: string) {
  const { data: user } = await octokit.users.getAuthenticated();
  const owner = user.login;
  
  console.log(`📦 Checking if repository ${owner}/${repoName} exists...`);
  
  let repoExists = false;
  try {
    await octokit.repos.get({ owner, repo: repoName });
    repoExists = true;
    console.log(`✅ Repository exists`);
  } catch (e: any) {
    if (e.status === 404) {
      console.log(`📝 Creating new repository...`);
      await octokit.repos.createForAuthenticatedUser({
        name: repoName,
        description: 'YouTube Research Automation - Scrape videos, extract transcripts, and generate content scripts',
        private: false,
        auto_init: false
      });
      console.log(`✅ Repository created: https://github.com/${owner}/${repoName}`);
    } else {
      throw e;
    }
  }
  
  return { owner, repoName };
}

async function initializeEmptyRepo(octokit: Octokit, owner: string, repo: string) {
  console.log(`📝 Initializing empty repository with README...`);
  
  // Create initial README to initialize the repo
  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: 'README.md',
    message: 'Initial commit',
    content: Buffer.from('# YouTube Research Automation\n\nInitializing repository...').toString('base64')
  });
  
  // Wait a moment for GitHub to process
  await new Promise(resolve => setTimeout(resolve, 2000));
}

async function pushFiles(octokit: Octokit, owner: string, repo: string, files: { path: string; content: string }[]) {
  console.log(`📤 Pushing ${files.length} files to GitHub...`);
  
  // Get the default branch
  let defaultBranch = 'main';
  let baseSha: string | undefined;
  let isEmptyRepo = false;
  
  try {
    const { data: repoData } = await octokit.repos.get({ owner, repo });
    defaultBranch = repoData.default_branch || 'main';
    
    // Get the latest commit SHA
    const { data: refData } = await octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${defaultBranch}`
    });
    baseSha = refData.object.sha;
  } catch (e: any) {
    if (e.status === 409 || e.message?.includes('empty')) {
      isEmptyRepo = true;
      console.log(`📝 Repository is empty, initializing...`);
      await initializeEmptyRepo(octokit, owner, repo);
      
      // Now get the ref
      const { data: refData } = await octokit.git.getRef({
        owner,
        repo,
        ref: `heads/${defaultBranch}`
      });
      baseSha = refData.object.sha;
    } else {
      throw e;
    }
  }
  
  // Create blobs for all files in batches to avoid rate limits
  console.log(`   Creating file blobs (this may take a few minutes)...`);
  const BATCH_SIZE = 10;  // Small batch to avoid secondary rate limits
  const DELAY_MS = 1000;  // 1 second delay between batches
  const blobs: { path: string; mode: '100644'; type: 'blob'; sha: string }[] = [];
  
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (file) => {
        const { data } = await octokit.git.createBlob({
          owner,
          repo,
          content: file.content,
          encoding: 'base64'
        });
        return {
          path: file.path,
          mode: '100644' as const,
          type: 'blob' as const,
          sha: data.sha
        };
      })
    );
    blobs.push(...batchResults);
    console.log(`   Processed ${Math.min(i + BATCH_SIZE, files.length)}/${files.length} files...`);
    
    // Add delay between batches to avoid secondary rate limits
    if (i + BATCH_SIZE < files.length) {
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }
  }
  
  // Create a tree
  console.log(`   Creating commit tree...`);
  const { data: tree } = await octokit.git.createTree({
    owner,
    repo,
    tree: blobs,
    base_tree: baseSha
  });
  
  // Create a commit
  const { data: commit } = await octokit.git.createCommit({
    owner,
    repo,
    message: 'Add TubeAutomator - YouTube Research Automation',
    tree: tree.sha,
    parents: baseSha ? [baseSha] : []
  });
  
  // Update the reference
  try {
    await octokit.git.updateRef({
      owner,
      repo,
      ref: `heads/${defaultBranch}`,
      sha: commit.sha
    });
  } catch (e) {
    // Create the reference if it doesn't exist
    await octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${defaultBranch}`,
      sha: commit.sha
    });
  }
  
  console.log(`✅ Successfully pushed to https://github.com/${owner}/${repo}`);
  return `https://github.com/${owner}/${repo}`;
}

async function main() {
  const repoName = process.argv[2] || 'tubeautomator';
  
  console.log('🚀 TubeAutomator - GitHub Push Script');
  console.log('=====================================\n');
  
  try {
    const octokit = await getUncachableGitHubClient();
    console.log('✅ Connected to GitHub\n');
    
    const { owner } = await createOrUpdateRepo(octokit, repoName);
    
    console.log('\n📁 Collecting files...');
    const files = getAllFiles('.');
    console.log(`   Found ${files.length} files to push\n`);
    
    const repoUrl = await pushFiles(octokit, owner, repoName, files);
    
    console.log('\n=====================================');
    console.log('✅ Push complete!');
    console.log(`🔗 Repository: ${repoUrl}`);
    console.log('\nYour project is now on GitHub!');
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
