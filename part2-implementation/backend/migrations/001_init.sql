-- R-1.1 data model. PostgreSQL 16, no extensions.
-- Tenant tables carry org_id and reference parents by (org_id, id), so the database itself
-- rejects cross-tenant references. Enumerations are CHECK constraints so values can be removed.

-- Organizations (also called workspaces) ------------------------------------------

CREATE TABLE organizations (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text        NOT NULL CHECK (length(trim(name)) > 0),
    slug        text        NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
    -- Workspace settings; jsonb so a new setting needs no migration.
    settings    jsonb       NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(settings) = 'object'),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Users are global: one person can belong to several organizations.
CREATE TABLE users (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    email       text        NOT NULL,
    name        text        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);
-- Case-insensitive uniqueness without the citext extension.
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

-- Membership and role-based access control. The role is per organization.
CREATE TABLE organization_members (
    org_id      uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role        text        NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (org_id, user_id)
);
-- Every request resolves the caller's memberships by user_id; INCLUDE makes it index-only.
CREATE INDEX organization_members_user_idx ON organization_members (user_id) INCLUDE (org_id, role);

-- Projects and their custom statuses --------------------------------------------

CREATE TABLE projects (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    name        text        NOT NULL CHECK (length(trim(name)) > 0),
    description text,
    created_by  uuid        REFERENCES users (id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    archived_at timestamptz,
    UNIQUE (org_id, name),  -- also serves "projects in this org" lookups
    UNIQUE (org_id, id)     -- target for composite tenant foreign keys
);

CREATE TABLE project_statuses (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      uuid        NOT NULL,
    project_id  uuid        NOT NULL,
    name        text        NOT NULL CHECK (length(trim(name)) > 0),
    -- Fixed category behind each custom status, so "done" means the same in every project.
    category    text        NOT NULL CHECK (category IN ('todo', 'in_progress', 'done')),
    position    integer     NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (org_id, project_id) REFERENCES projects (org_id, id) ON DELETE CASCADE,
    UNIQUE (project_id, name),
    UNIQUE (project_id, id) -- lets tasks require a status from their own project
);

-- Labels are shared across all projects in an organization.
CREATE TABLE labels (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    name        text        NOT NULL CHECK (length(trim(name)) > 0),
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (org_id, name),
    UNIQUE (org_id, id)
);

-- Tasks ------------------------------------------------------------------------

CREATE TABLE tasks (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      uuid        NOT NULL,
    project_id  uuid        NOT NULL,
    status_id   uuid        NOT NULL,
    title       text        NOT NULL CHECK (length(trim(title)) > 0),
    description text,
    priority    text        NOT NULL DEFAULT 'medium'
                            CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    assignee_id uuid,
    created_by  uuid        REFERENCES users (id) ON DELETE SET NULL,
    -- A calendar date, not a timestamp: a task is overdue from the day after due_date.
    due_date    date,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (org_id, id),
    FOREIGN KEY (org_id, project_id) REFERENCES projects (org_id, id) ON DELETE CASCADE,
    -- Status must come from the task's own project. NO ACTION (not RESTRICT) lets a project
    -- delete cascade to statuses and tasks together; deleting a status in use still fails.
    FOREIGN KEY (project_id, status_id) REFERENCES project_statuses (project_id, id),
    -- Assignee must be a member of the task's organization; removing them unassigns the task.
    FOREIGN KEY (org_id, assignee_id) REFERENCES organization_members (org_id, user_id)
        ON DELETE SET NULL (assignee_id)
);

-- Board order and keyset cursor (newest first, id as tiebreaker).
CREATE INDEX tasks_project_created_idx ON tasks (project_id, created_at DESC, id DESC);
-- Status filter and summary counts; also covers the status FK.
CREATE INDEX tasks_project_status_idx ON tasks (project_id, status_id);
-- Assignee filter within a project.
CREATE INDEX tasks_project_assignee_idx ON tasks (project_id, assignee_id);
-- "My overdue tasks across projects"; also covers the assignee FK.
CREATE INDEX tasks_assignee_due_idx ON tasks (assignee_id, due_date);

CREATE TABLE task_labels (
    org_id      uuid        NOT NULL,
    task_id     uuid        NOT NULL,
    label_id    uuid        NOT NULL,
    PRIMARY KEY (task_id, label_id),
    FOREIGN KEY (org_id, task_id)  REFERENCES tasks (org_id, id)  ON DELETE CASCADE,
    FOREIGN KEY (org_id, label_id) REFERENCES labels (org_id, id) ON DELETE CASCADE
);
CREATE INDEX task_labels_label_idx ON task_labels (label_id);

-- Comments and activity history ------------------------------------------------

CREATE TABLE task_comments (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      uuid        NOT NULL,
    task_id     uuid        NOT NULL,
    author_id   uuid        REFERENCES users (id) ON DELETE SET NULL,
    body        text        NOT NULL CHECK (length(trim(body)) > 0),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (org_id, task_id) REFERENCES tasks (org_id, id) ON DELETE CASCADE
);
CREATE INDEX task_comments_task_idx ON task_comments (task_id, created_at);

-- Append-only history, one row per changed field. A bigint identity gives a cheap,
-- monotonic pagination order; these rows are never referenced from outside.
CREATE TABLE task_activity (
    id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    org_id      uuid        NOT NULL,
    task_id     uuid        NOT NULL,
    actor_id    uuid        REFERENCES users (id) ON DELETE SET NULL,
    action      text        NOT NULL CHECK (action IN ('created', 'updated')),
    -- jsonb because changed fields differ in type (uuid, text, date).
    field       text,
    old_value   jsonb,
    new_value   jsonb,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CHECK ((action = 'updated') = (field IS NOT NULL)),
    FOREIGN KEY (org_id, task_id) REFERENCES tasks (org_id, id) ON DELETE CASCADE
);
CREATE INDEX task_activity_task_idx ON task_activity (task_id, id DESC);
