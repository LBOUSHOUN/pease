import postgres from "postgres";

const identifier = String(process.argv[2] ?? "").trim().toLowerCase();
if (!identifier || !process.env.DATABASE_URL) {
  console.error("Usage: DATABASE_URL=... node scripts/inspect-user-status.mjs <identifiant>");
  process.exitCode = 2;
} else {
  const sql = postgres(process.env.DATABASE_URL, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
  });
  try {
    const rows = await sql`
      select
        username,
        email,
        role,
        is_active,
        must_change_password,
        length(password_hash) > 0 as password_hash_present,
        case
          when password_hash like '$argon2id$%' then 'argon2id'
          when password_hash like '$argon2i$%' then 'argon2i'
          when password_hash like '$argon2d$%' then 'argon2d'
          else 'unknown'
        end as password_algorithm
      from users
      where lower(trim(username)) = ${identifier}
         or lower(trim(coalesce(email, ''))) = ${identifier}
    `;
    const duplicates = await sql`
      select count(*)::int as count
      from users
      where lower(trim(username)) = ${identifier}
    `;
    const user = rows[0];
    console.log(JSON.stringify({
      exists: Boolean(user),
      usernameMatches: user
        ? user.username.trim().toLowerCase() === identifier
        : false,
      emailMatches: user?.email
        ? user.email.trim().toLowerCase() === identifier
        : false,
      active: user?.is_active ?? null,
      role: user?.role ?? null,
      mustChangePassword: user?.must_change_password ?? null,
      passwordHashPresent: user?.password_hash_present ?? false,
      passwordAlgorithm: user?.password_algorithm ?? null,
      normalizedUsernameCount: duplicates[0]?.count ?? 0,
      organizationMembership: "not_applicable_single_shop_schema",
    }));
  } finally {
    await sql.end();
  }
}
