import { handle } from "hono/vercel"
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi"
import { promises as fs } from "fs"
import path from "path"

const app = new OpenAPIHono()

// Define the response schema
const registryResponseSchema = z
  .object({
    message: z.string(),
    links: z.array(
      z.object({
        rel: z.string(),
        href: z.string(),
      })
    ),
  })
  .openapi("registryResponseSchema")

// Define the route with OpenAPI metadata
const getRegistryRoute = createRoute({
  method: "get",
  path: "/registry",
  tags: ["Registry"],
  description: "Get a list of registry items with links to their details",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.array(
            z.object({
              name: z.string(),
              type: z.string(),
              _links: z.object({
                self: z.object({
                  href: z.string(),
                }),
              }),
            })
          ),
        },
      },
      description: "Successful response with a list of registry items",
    },
  },
})

app.openapi(getRegistryRoute, async (c) => {
  const registryDir = path.resolve("fake-registry")
  // read registry/index.json
  const indexJson = await fs.readFile(
    path.join(registryDir, "index.json"),
    "utf-8"
  )
  const index = JSON.parse(indexJson)
  const url = new URL(c.req.url)
  const baseUrl = `${url.protocol}//${url.host}`

  return c.json(
    index.map((item: any) => ({
      ...item,
      _links: {
        self: { href: `${baseUrl}/registry/${item.name}` },
      },
    }))
  ) as never
})

// Define a new route to get individual item details
const getItemRoute = createRoute({
  method: "get",
  path: "/registry/:itemName",
  tags: ["Registry"],
  description: "Get detailed information of a specific registry item",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            name: z.string(),
            type: z.string(),
            files: z.array(
              z.object({
                path: z.string(),
                hash: z.string(),
                content: z.string(),
                commit: z.string(),
                timestamp: z.string(),
                history: z.array(
                  z.object({
                    hash: z.string(),
                    content: z.string(),
                    commit: z.string(),
                    timestamp: z.string(),
                  })
                ),
                versions: z.number(),
              })
            ),
            _links: z.object({
              index: z.object({
                href: z.string(),
              }),
              self: z.object({
                href: z.string(),
              }),
            }),
          }),
        },
      },
      description: "Successful response with detailed item information",
    },
    404: {
      content: {
        "application/json": {
          schema: z.object({
            error: z.string(),
          }),
        },
      },
      description: "Item not found",
    },
  },
})

app.openapi(getItemRoute, async (c) => {
  const { itemName } = c.req.param()
  const registryDir = path.resolve("fake-registry/items")
  const filePath = path.join(registryDir, `${itemName}.json`)

  try {
    const fileContent = await fs.readFile(filePath, "utf-8")
    const item = JSON.parse(fileContent)
    const url = new URL(c.req.url)
    const baseUrl = `${url.protocol}//${url.host}`

    return c.json({
      ...item,
      _links: {
        index: { href: `${baseUrl}/registry` },
        self: { href: `${baseUrl}/registry/${item.name}` },
      },
    }) as never
  } catch (error) {
    return c.json({ error: "Item not found" }, 404) as never
  }
})

// Add OpenAPI documentation endpoint
app.doc("/doc", {
  openapi: "3.0.0",
  info: {
    title: "Registry API",
    version: "1.0.0",
    description: "API for registry operations",
  },
})

const handler = handle(app)

export const GET = handler
export const POST = handler
export const PATCH = handler
export const PUT = handler
export const OPTIONS = handler
