package migration

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"testing"
	"time"

	annotationV0 "github.com/grafana/grafana/apps/annotation/pkg/apis/annotation/v0alpha1"
	"github.com/grafana/grafana/pkg/api/dtos"
	"github.com/grafana/grafana/pkg/extensions/apiserver/tests/mt"
	"github.com/grafana/grafana/pkg/infra/db"
	"github.com/grafana/grafana/pkg/server"
	"github.com/grafana/grafana/pkg/services/annotations"
	"github.com/grafana/grafana/pkg/tests/testinfra"
	"github.com/grafana/grafana/pkg/util/testutil/pgtest"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"
)

var annotationGVR = annotationV0.AnnotationKind().GroupVersionResource()

// newAPI is the standalone annotation API server (postgres, --skip-auth) that the
// legacy proxy targets.
type newAPI struct {
	url   string
	store *pgStore
}

// startNewAPI boots the standalone annotation API server on a throwaway postgres
// database. Both are bound to t, so they are torn down with the owning test.
func startNewAPI(t *testing.T) *newAPI {
	t.Helper()
	dsn := pgtest.NewDatabase(t)

	runner := mt.RunInsecureServer(t, annotationGVR, []string{
		"--annotation.store-backend=postgres",
		fmt.Sprintf("--annotation.postgres-connection-string=%s", dsn),
		"--annotation.enable-legacy-id=true",
		fmt.Sprintf("--cert-dir=%s", t.TempDir()),
	})

	return &newAPI{
		url:   fmt.Sprintf("https://localhost:%d", runner.HttpPort),
		store: &pgStore{dsn: dsn},
	}
}

// migrationHarness wires the shared standalone API server together with a fresh
// legacy Grafana server whose migration proxy targets it, for one scenario.
type migrationHarness struct {
	legacyAddr string
	env        *server.TestEnv
	newStore   *pgStore
}

// newMigrationHarness starts a legacy Grafana server in the specified migration
// phase pointed at the shared new API, and truncates the new store so the scenario
// starts clean.
func newMigrationHarness(t *testing.T, api *newAPI, phase string) *migrationHarness {
	t.Helper()
	api.store.truncate(t)

	opts := testinfra.GrafanaOpts{
		DisableAnonymous:           true,
		AnnotationMigrationPhase:   phase,
		AnnotationAPIServerURL:     api.url,
		AnnotationProxyStaticToken: "migration-test-token",
	}
	dir, cfgPath := testinfra.CreateGrafDir(t, opts)

	addr, env := testinfra.StartGrafanaEnv(t, dir, cfgPath)

	return &migrationHarness{
		legacyAddr: addr,
		env:        env,
		newStore:   api.store,
	}
}

// createAnnotation POSTs to the legacy API and returns the assigned legacy ID.
// It defaults an unset Time to time.Now().
func (h *migrationHarness) createAnnotation(t *testing.T, cmd dtos.PostAnnotationsCmd) int64 {
	t.Helper()
	if cmd.Time == 0 {
		cmd.Time = time.Now().UnixMilli()
	}
	var out struct {
		ID      int64  `json:"id"`
		Message string `json:"message"`
	}
	h.doJSON(t, http.MethodPost, "/api/annotations", cmd, http.StatusOK, &out)
	return out.ID
}

// getAnnotationByID GETs /api/annotations/:id and returns the DTO.
func (h *migrationHarness) getAnnotationByID(t *testing.T, id int64) *annotations.ItemDTO {
	t.Helper()
	var dto annotations.ItemDTO
	h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/annotations/%d", id), nil, http.StatusOK, &dto)
	return &dto
}

// listAnnotations GETs /api/annotations with the given query string (without the
// leading "?") and returns the DTOs.
func (h *migrationHarness) listAnnotations(t *testing.T, query string) []*annotations.ItemDTO {
	t.Helper()
	path := "/api/annotations"
	if query != "" {
		path += "?" + query
	}
	var dtos []*annotations.ItemDTO
	h.doJSON(t, http.MethodGet, path, nil, http.StatusOK, &dtos)
	return dtos
}

// seedLegacyOnly inserts a row straight into the legacy xorm store, bypassing the
// proxy, to emulate a record that predates the migration (or an alert
// annotation). Returns the assigned legacy ID.
func (h *migrationHarness) seedLegacyOnly(t *testing.T, item *annotations.Item) int64 {
	t.Helper()
	if item.OrgID == 0 {
		item.OrgID = 1
	}
	if item.Epoch == 0 {
		item.Epoch = time.Now().UnixMilli()
	}
	err := h.env.SQLStore.WithDbSession(t.Context(), func(sess *db.Session) error {
		_, err := sess.Table("annotation").Insert(item)
		return err
	})
	require.NoError(t, err)
	require.NotZero(t, item.ID)
	return item.ID
}

// legacyCount returns the number of rows in the legacy xorm annotation table.
func (h *migrationHarness) legacyCount(t *testing.T) int {
	t.Helper()
	var count int64
	err := h.env.SQLStore.WithDbSession(t.Context(), func(sess *db.Session) error {
		_, err := sess.SQL("SELECT COUNT(*) FROM annotation").Get(&count)
		return err
	})
	require.NoError(t, err)
	return int(count)
}

// doJSON issues an authenticated (admin) request against the legacy API and,
// when out is non-nil, decodes a successful JSON response into it.
func (h *migrationHarness) doJSON(t *testing.T, method, path string, body any, wantStatus int, out any) {
	t.Helper()
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		require.NoError(t, err)
		rdr = bytes.NewReader(b)
	}
	url := fmt.Sprintf("http://admin:admin@%s%s", h.legacyAddr, path)
	req, err := http.NewRequest(method, url, rdr)
	require.NoError(t, err)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	raw, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	require.Equalf(t, wantStatus, resp.StatusCode, "%s %s -> %d: %s", method, path, resp.StatusCode, raw)
	if out != nil {
		require.NoError(t, json.Unmarshal(raw, out), "decode %s %s response: %s", method, path, raw)
	}
}

// pgStore queries the new API's postgres store directly for assertions.
type pgStore struct {
	dsn string
}

// truncate empties the new store between subtests that share the server. TRUNCATE
// on the partitioned parent cascades to all week partitions.
func (s *pgStore) truncate(t *testing.T) {
	t.Helper()
	ctx := t.Context()
	conn, err := pgx.Connect(ctx, s.dsn)
	require.NoError(t, err)
	defer func() { _ = conn.Close(ctx) }()

	_, err = conn.Exec(ctx, "TRUNCATE TABLE annotations")
	require.NoError(t, err)
}

// countByLegacyID counts rows in the new store carrying the given legacy ID.
func (s *pgStore) countByLegacyID(t *testing.T, legacyID int64) int {
	t.Helper()
	ctx := t.Context()
	conn, err := pgx.Connect(ctx, s.dsn)
	require.NoError(t, err)
	defer func() { _ = conn.Close(ctx) }()

	var count int
	err = conn.QueryRow(ctx, "SELECT COUNT(*) FROM annotations WHERE legacy_id = $1", legacyID).Scan(&count)
	require.NoError(t, err)
	return count
}
