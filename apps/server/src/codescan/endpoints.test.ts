import { describe, expect, it } from 'vitest';
import { extractEndpoints, type Endpoint } from './endpoints.ts';

function brief(endpoints: readonly Endpoint[]) {
  return endpoints.map((endpoint) =>
    [endpoint.kind, endpoint.method ?? '*', endpoint.path, endpoint.base ? 'base' : '']
      .join(' ')
      .trim(),
  );
}

describe('extractEndpoints', () => {
  it('finds Express routes and mounts in files that import a server framework', () => {
    const text = [
      "import { Router } from 'express';",
      'const router = Router();',
      "router.get('/orders/:id', async (req, res) => res.json({}));",
      "router.post('/orders', handler);",
      "app.use('/api', router);",
      "router.route('/items').get(list);",
    ].join('\n');
    expect(brief(extractEndpoints('src/routes.ts', text, 'typescript', ['express']))).toEqual([
      'route GET /orders/:id',
      'route POST /orders',
      'mount * /api',
      'route * /items',
    ]);
  });

  it('finds client calls: fetch with methods, axios, templates, base-URL concatenation and wrappers', () => {
    const text = [
      "const rows = await fetch('/api/orders');",
      'await fetch(`/api/orders/${id}`, { method: "DELETE" });',
      "await axios.post('/api/orders', body);",
      'await fetch(`${API_BASE}/users/${userId}`);',
      "await request(BASE_URL + '/reports/daily');",
      "const data = useSWR('/api/me');",
      "navigate('/orders');",
      "searchParams.get('/not-a-call');",
    ].join('\n');
    expect(brief(extractEndpoints('src/api.ts', text, 'typescript', ['react']))).toEqual([
      'call POST /api/orders',
      'call GET /api/orders',
      'call DELETE /api/orders/${id}',
      'call GET /users/${userId} base',
      'call * /reports/daily base',
      'call GET /api/me',
    ]);
  });

  it('reads NestJS controllers and Next.js route files', () => {
    const nest =
      "import { Controller, Get } from '@nestjs/common';\n@Controller('orders')\nclass C {\n  @Get(':id') one() {}\n  @Post() create() {}\n}";
    expect(
      brief(extractEndpoints('src/orders.controller.ts', nest, 'typescript', ['@nestjs/common'])),
    ).toEqual(['route GET /orders/:id', 'route POST /orders']);
    const next = 'export async function GET() {}\nexport const POST = handler;';
    expect(brief(extractEndpoints('app/api/orders/[id]/route.ts', next, 'typescript', []))).toEqual(
      ['route GET /api/orders/:id', 'route POST /api/orders/:id'],
    );
    expect(brief(extractEndpoints('pages/api/users/index.ts', '', 'typescript', []))).toEqual([
      'route * /api/users',
    ]);
  });

  it('reads FastAPI, Flask and Django routes and requests calls in Python', () => {
    const fastapi =
      'router = APIRouter(prefix="/v1")\n@router.get("/items/{item_id}")\ndef read(): ...\n@app.route("/legacy", methods=["GET", "POST"])\ndef legacy(): ...\nrequests.get(f"{BASE}/health")';
    expect(brief(extractEndpoints('api/items.py', fastapi, 'python', ['fastapi']))).toEqual([
      'route GET /v1/items/{item_id}',
      'route GET /v1/legacy',
      'route POST /v1/legacy',
      'call GET /health base',
    ]);
    const django =
      "urlpatterns = [path('orders/<int:pk>/', views.order), path('api/', include('api.urls'))]";
    expect(brief(extractEndpoints('shop/urls.py', django, 'python', ['django.urls']))).toEqual([
      'route * /orders/:pk/',
      'mount * /api/',
    ]);
  });

  it('reads Go and Spring routes', () => {
    const go =
      'r.GET("/orders/:id", show)\nhttp.HandleFunc("POST /orders/{id}", h)\nv1 := r.Group("/v1")\nresp, _ := http.Get("https://x.test/health")';
    expect(brief(extractEndpoints('main.go', go, 'go', ['net/http']))).toEqual([
      'route GET /orders/:id',
      'route POST /orders/:id',
      'call GET /health',
      'mount * /v1',
    ]);
    const spring =
      '@RestController\n@RequestMapping("/api/orders")\npublic class OrderController {\n  @GetMapping("/{id}") Order one() {}\n  @PostMapping Order create() {}\n}';
    expect(brief(extractEndpoints('OrderController.java', spring, 'java', []))).toEqual([
      'route GET /api/orders/{id}',
      'route POST /api/orders',
    ]);
  });

  it('reads OpenAPI specs, GraphQL schemas and operations, and env keys', () => {
    const yaml =
      'openapi: 3.0.0\nbasePath: /api\npaths:\n  /orders/{id}:\n    get:\n      summary: x\n    delete:\n      summary: y\n';
    expect(brief(extractEndpoints('openapi.yaml', yaml, null, []))).toEqual([
      'mount * /api',
      'route GET /orders/:id',
      'route DELETE /orders/:id',
    ]);
    const json = JSON.stringify({ openapi: '3.1.0', paths: { '/users': { post: {} } } });
    expect(brief(extractEndpoints('spec/openapi.json', json, null, []))).toEqual([
      'route POST /users',
    ]);
    const schema =
      'type Query {\n  orders(first: Int): [Order]\n  me: User\n}\ntype Mutation { placeOrder(input: X): Order }';
    expect(brief(extractEndpoints('schema.graphql', schema, null, []))).toEqual([
      'gql_field * Query.orders',
      'gql_field * Query.me',
      'gql_field * Mutation.placeOrder',
    ]);
    const client =
      'const Q = gql`query Orders($n: Int) { list: orders(first: $n) { id } }`;\nprocess.env.API_URL;';
    expect(brief(extractEndpoints('src/q.ts', client, 'typescript', []))).toEqual([
      'env * API_URL',
      'gql_op * Query.orders',
    ]);
  });

  it('records line numbers', () => {
    const [endpoint] = extractEndpoints('a.ts', "\n\nfetch('/x/y')", 'typescript', []);
    expect(endpoint?.line).toBe(3);
  });
});
