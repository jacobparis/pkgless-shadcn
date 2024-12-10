import fs from "fs/promises"
import path from "path"
import crypto from "crypto"

type RegistryFile = {
  path: string
  hash: string
  content: string
  commit: string
  timestamp: string
  history: Array<{
    hash: string
    content: string
    commit: string
    timestamp: string
  }>
  versions: number
}

export async function buildRegistry({
  registryIndex,
  componentPath,
  outputPath,
  commit,
  commitDate,
  existingRegistry,
}: {
  registryIndex: Array<any>
  componentPath: string
  outputPath: string
  commit: string
  commitDate: string
  existingRegistry?: Array<any>
}) {
  console.log({ registryIndex })
  let mirrorRegistry = existingRegistry || []
  const changelog: Array<{
    name: string
    filePath: string
    changeType: string
  }> = []

  if (!mirrorRegistry.length) {
    const existingRegistryData =
      (await loadJSON(path.join(outputPath, "index.json"))) || []

    for (const component of existingRegistryData) {
      const componentPath = path.join(
        outputPath,
        "items",
        `${component.name}.json`
      )
      const componentData = await loadJSON(componentPath)
      mirrorRegistry.push({
        ...component,
        ...componentData,
      })
    }
  }

  await fs.mkdir(path.join(outputPath, "items"), { recursive: true })

  for (const component of registryIndex) {
    const { name, type, dependencies, files } = component

    let mirrorComponent = mirrorRegistry.find((c: any) => c.name === name)
    if (!mirrorComponent) {
      mirrorComponent = {
        name,
        type,
        dependencies,
        files: [],
      }
      mirrorRegistry.push(mirrorComponent)
    }

    for (const file of files) {
      const content = await fs.readFile(
        path.resolve(componentPath, file.path),
        "utf-8"
      )
      const hash = createHash(content)

      const existingFileIndex = mirrorComponent.files.findIndex(
        (f: { path: string }) => f.path === file.path
      )

      if (
        existingFileIndex === -1 ||
        mirrorComponent.files[existingFileIndex].hash !== hash
      ) {
        const existingFile =
          existingFileIndex !== -1
            ? mirrorComponent.files[existingFileIndex]
            : null

        if (existingFile) {
          const history = existingFile.history || []
          if (
            !history.some(
              (entry: { hash: string }) => entry.hash === existingFile.hash
            )
          ) {
            history.push({
              hash: existingFile.hash,
              content: existingFile.content,
              commit: existingFile.commit,
              timestamp: existingFile.timestamp,
            })
          }
        }

        const newFile: RegistryFile = {
          path: file.path,
          hash,
          content,
          commit,
          timestamp: commitDate,
          history: existingFile?.history || [],
          versions: (existingFile?.history?.length || 0) + 1,
        }

        if (existingFileIndex !== -1) {
          mirrorComponent.files[existingFileIndex] = newFile
          changelog.push({ name, filePath: file.path, changeType: "updated" })
        } else {
          mirrorComponent.files.push(newFile)
          changelog.push({ name, filePath: file.path, changeType: "added" })
        }
      }
    }

    await saveJSON(
      path.join(outputPath, "items", `${name}.json`),
      mirrorComponent
    )
  }

  // Create simplified version only when writing to index.json
  const simplifiedRegistry = mirrorRegistry.map((component: any) => ({
    name: component.name,
    type: component.type,
    dependencies: component.dependencies,
    files: component.files.map((f: RegistryFile) => ({
      path: f.path,
      versions: f.versions,
    })),
  }))

  await saveJSON(path.join(outputPath, "index.json"), simplifiedRegistry)

  console.log("Changes made to the registry:", changelog)

  return mirrorRegistry
}

export async function buildLegacyRegistry({
  registryIndex,
  componentPath,
  outputPath,
  commit,
  commitDate,
  existingRegistry,
}: {
  registryIndex: Array<any>
  componentPath: string
  outputPath: string
  commit: string
  commitDate: string
  existingRegistry?: Array<any>
}) {
  let mirrorRegistry = existingRegistry || []
  const changelog: Array<{
    name: string
    filePath: string
    changeType: string
  }> = []

  if (!mirrorRegistry.length) {
    const existingRegistryData =
      (await loadJSON(path.join(outputPath, "index.json"))) || []
    for (const component of existingRegistryData) {
      const outputComponentPath = path.join(
        outputPath,
        "items",
        `${component.name}.json`
      )
      const componentData = await loadJSON(outputComponentPath)
      mirrorRegistry.push({
        ...component,
        ...componentData,
      })
    }
  }

  await fs.mkdir(path.join(outputPath, "items"), { recursive: true })

  for (const component of registryIndex) {
    const { name, type, dependencies, files } = component

    let mirrorComponent = mirrorRegistry.find((c: any) => c.name === name)
    if (!mirrorComponent) {
      mirrorComponent = {
        name,
        type,
        dependencies,
        files: [],
      }
      mirrorRegistry.push(mirrorComponent)
    }

    for (const filePath of files) {
      const content = await fs.readFile(
        path.resolve(componentPath, filePath),
        "utf-8"
      )
      const hash = createHash(content)

      // legacy registry uses an array of paths instead of { path: string }
      const existingFileIndex = mirrorComponent.files.findIndex(
        (f: { path: string }) => f.path === filePath
      )

      if (
        existingFileIndex === -1 ||
        mirrorComponent.files[existingFileIndex].hash !== hash
      ) {
        const existingFile =
          existingFileIndex !== -1
            ? mirrorComponent.files[existingFileIndex]
            : null

        if (existingFile) {
          const history = existingFile.history || []
          if (
            !history.some(
              (entry: { hash: string }) => entry.hash === existingFile.hash
            )
          ) {
            history.push({
              hash: existingFile.hash,
              content: existingFile.content,
              commit: existingFile.commit,
              timestamp: existingFile.timestamp,
            })
          }
        }

        const newFile: RegistryFile = {
          path: filePath,
          hash,
          content,
          commit,
          timestamp: commitDate,
          history: existingFile?.history || [],
          versions: (existingFile?.history?.length || 0) + 1,
        }

        if (existingFileIndex !== -1) {
          mirrorComponent.files[existingFileIndex] = newFile
          changelog.push({ name, filePath, changeType: "updated" })
        } else {
          mirrorComponent.files.push(newFile)
          changelog.push({ name, filePath, changeType: "added" })
        }
      }
    }

    await saveJSON(
      path.join(outputPath, "items", `${name}.json`),
      mirrorComponent
    )
  }

  // Create simplified version only when writing to index.json
  const simplifiedRegistry = mirrorRegistry.map((component: any) => ({
    name: component.name,
    type: component.type,
    dependencies: component.dependencies,
    files: component.files.map((f: RegistryFile) => ({
      path: f.path,
      versions: f.versions,
    })),
  }))

  await saveJSON(path.join(outputPath, "index.json"), simplifiedRegistry)

  console.log("Changes made to the registry:", changelog)

  return mirrorRegistry
}

async function loadJSON(filePath: string): Promise<any> {
  try {
    const data = await fs.readFile(filePath, "utf-8")
    return JSON.parse(data)
  } catch {
    console.log(`Failed to load JSON file ${filePath}`)
    return undefined
  }
}

async function saveJSON(filePath: string, data: any): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8")
}

function createHash(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex")
}
