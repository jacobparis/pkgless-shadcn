import fs from "fs/promises"
import path from "path"
import { execSync } from "child_process"
import simpleGit from "simple-git"
import { buildLegacyRegistry, buildRegistry } from "./build-registry"
import { minimatch } from "minimatch"
import yaml from "js-yaml"

const SHADCN_REPO = "https://github.com/shadcn-ui/ui"
const LOCAL_REPO_BASE = "./repos"
const LOCAL_REPO = path.join(LOCAL_REPO_BASE, "shadcn-ui-repo")
const MIRROR_REGISTRY_PATH = "./fake-registry"

// Ensure the directory exists
async function ensureDirectoryExists(directory: string): Promise<void> {
  try {
    await fs.mkdir(directory, { recursive: true })
  } catch (error) {
    console.error(`Failed to create directory ${directory}:`, error)
    throw error
  }
}

async function cloneOrUpdateRepo(): Promise<void> {
  await ensureDirectoryExists(LOCAL_REPO_BASE)
  const git = simpleGit()
  if (!(await fs.stat(LOCAL_REPO).catch(() => false))) {
    console.log(`Cloning repository ${SHADCN_REPO}...`)
    await git.clone(SHADCN_REPO, LOCAL_REPO, ["--quiet"])
  } else {
    console.log("Updating repository...")
    await git.cwd(LOCAL_REPO).fetch(["--quiet"])
  }
}

async function checkoutCommit(commit: string): Promise<void> {
  const git = simpleGit(LOCAL_REPO)
  console.log(`Checking out commit ${commit}...`)
  await git.reset(["--hard"])
  await git.checkout(commit)
}

async function getPnpmVersion(): Promise<string> {
  const lockfilePath = path.join(LOCAL_REPO, "pnpm-lock.yaml")
  try {
    const lockfileContent = await fs.readFile(lockfilePath, "utf-8")
    const lockfileData = yaml.load(lockfileContent) as any
    if (lockfileData.lockfileVersion) {
      return lockfileData.lockfileVersion.toString()
    }
    console.warn(
      "No pnpm version specified in pnpm-lock.yaml. Using default version."
    )
    return "latest" // Fallback to the latest version if not specified
  } catch (error) {
    console.warn(
      "Could not read pnpm-lock.yaml to determine pnpm version:",
      error
    )
    return "latest" // Fallback to the latest version if there's an error
  }
}

async function buildRegistryFiles(): Promise<void> {
  console.log("Building registry...")
  try {
    const pnpmVersion = await getPnpmVersion()
    const pnpmCommand = `npx --yes pnpm@${pnpmVersion}`

    execSync(`${pnpmCommand} install --force`, {
      cwd: LOCAL_REPO,
      stdio: "inherit",
    })
    // execSync(`${pnpmCommand} run build:registry --silent`, { cwd: LOCAL_REPO,  stdio: 'inherit' });
  } catch (error) {
    console.error("Failed to build registry:", error)
    throw error
  }
}

async function getCommitDate(commit: string): Promise<string> {
  const git = simpleGit(LOCAL_REPO)
  const result = await git.show(["-s", "--format=%cI", commit])
  return result.trim()
}

async function getCommitsBetween(
  startHash?: string,
  endHash?: string
): Promise<Array<{ hash: string; message: string; date: Date }>> {
  const git = simpleGit(LOCAL_REPO)

  // Checkout the main branch first
  await git.checkout("main", ["--force"])
  await git.pull("origin", "main") // Ensure the branch is up-to-date

  const result = await git.log({
    from: startHash,
    to: endHash || "HEAD",
    ["--topo-order"]: null,
  })

  // Add commit date to each commit and sort by date
  return result.all
    .map((commit) => ({
      hash: commit.hash,
      message: commit.message,
      date: new Date(commit.date),
    }))
    .toSorted((a, b) => a.date.getTime() - b.date.getTime())
}

async function getChangedFiles(commit: string): Promise<string[]> {
  const git = simpleGit(LOCAL_REPO)
  const result = await git.show(["--name-only", "--pretty=format:", commit])
  return result.trim().split("\n").filter(Boolean)
}

async function hasRelevantChanges(
  commit: string,
  watchPatterns: string[]
): Promise<boolean> {
  const changedFiles = await getChangedFiles(commit)
  return changedFiles.some((file) =>
    watchPatterns.some((pattern) => minimatch(file, pattern))
  )
}

async function main() {
  const startHash = process.argv[2]
  const endHash = process.argv[3]
  const watchPatterns = ["apps/www/registry/**/*"]

  // Handle process exit signals
  process.on("SIGINT", () => {
    console.log("Process interrupted. Exiting...")
    process.exit(0)
  })

  process.on("SIGTERM", () => {
    console.log("Process terminated. Exiting...")
    process.exit(0)
  })

  try {
    await cloneOrUpdateRepo()

    let commits
    if (endHash) {
      commits = await getCommitsBetween(startHash, endHash)
    } else {
      // If no endHash is provided, assume a single commit to process
      commits = [{ hash: startHash, message: "Single commit processing" }]
    }

    console.log("\nCommits to process:")
    const commitsToProcess = await Promise.all(
      commits.map(async ({ hash, message }) => {
        if (!(await hasRelevantChanges(hash, watchPatterns))) {
          console.log(`skip ${hash.substring(0, 7)} - ${message}`)
          return
        }
        console.log(`process ${hash.substring(0, 7)} - ${message}`)
        return hash
      })
    )
    console.log(`\nTotal commits: ${commitsToProcess.length}`)

    let existingRegistry
    for (const hash of commitsToProcess) {
      if (!hash) continue

      await checkoutCommit(hash)
      const commitDate = await getCommitDate(hash)

      try {
        await buildRegistryFiles()
      } catch (error) {
        console.warn(`Failed to build registry for commit ${hash}:`, error)
        continue
      }
      // Determine the registry path based on the commit date
      try {
        const registryPath = path.resolve(
          path.join(LOCAL_REPO, "apps/www/public/r/index.json")
        )
        const registryIndex = await loadJSON(registryPath)

        if (registryIndex) {
          existingRegistry = await buildRegistry({
            registryIndex,
            componentPath: path.resolve(
              path.join(LOCAL_REPO, "apps/www/registry/default")
            ),
            outputPath: path.resolve(MIRROR_REGISTRY_PATH),
            commit: hash,
            commitDate,
            existingRegistry,
          })
        } else {
          const legacyRegistryPath = path.resolve(
            path.join(LOCAL_REPO, "apps/www/public/registry/index.json")
          )
          const legacyRegistryIndex = await loadJSON(legacyRegistryPath)
          existingRegistry = await buildLegacyRegistry({
            registryIndex: legacyRegistryIndex,
            componentPath: path.resolve(
              path.join(LOCAL_REPO, "apps/www/registry/default")
            ),
            outputPath: path.resolve(MIRROR_REGISTRY_PATH),
            commit: hash,
            commitDate,
            existingRegistry,
          })
        }

        console.log(`Registry built successfully for commit ${hash}`)
      } catch (error) {
        console.warn(`Failed to mirror registry for commit ${hash}:`, error)
        continue
      }
    }

    console.log("\nAll commits processed.")
  } catch (error) {
    console.error("Error during build:", error)
    process.exit(1)
  }
}

main()

async function loadJSON(filePath: string): Promise<any> {
  try {
    const data = await fs.readFile(filePath, "utf-8")
    return JSON.parse(data)
  } catch {
    console.log(`Failed to load JSON file ${filePath}`)
    return undefined
  }
}
