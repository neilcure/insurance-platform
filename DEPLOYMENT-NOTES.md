# Deployment & Server Commands Reference

## Architecture Overview

```
LOCAL (your PC)                    VPS (Hostinger)
├── localhost:3000                 ├── https://bravogi.com
├── Docker: insurance_postgres     ├── Docker: insurance-platform-db-1
├── Database: local dev data       ├── Database: production data
└── Code → git push ──────────────→└── Portainer → Pull & redeploy
```

---

## Daily Development Workflow

```bash
# 1. Develop locally
npm run dev

# 2. When ready, push code to GitHub
git add .
git commit -m "your message"
git push origin main

# 3. Go to Portainer (https://31.97.187.61:9443)
#    → Stacks → insurance-platform → Pull and redeploy
```

---

## SSH into VPS

```bash
ssh root@31.97.187.61
```

---

## Docker Commands (run on VPS)

### Check running containers
```bash
docker ps              # Show running containers
docker ps -a           # Show ALL containers (including stopped)
```

### View logs
```bash
docker logs insurance-platform-app-1            # App logs (all)
docker logs insurance-platform-app-1 --tail 50  # Last 50 lines
docker logs insurance-platform-app-1 -f         # Follow live logs (Ctrl+C to stop)
docker logs insurance-platform-db-1             # Database logs
```

### Restart containers
```bash
docker restart insurance-platform-app-1   # Restart app only
docker restart insurance-platform-db-1    # Restart database only
```

### Stop & start everything
```bash
docker compose down          # Stop all containers
docker compose up -d         # Start all containers
docker compose up -d --build # Rebuild and start (after code changes)
```

### Enter a container's shell
```bash
docker exec -it insurance-platform-app-1 sh     # App container shell
docker exec -it insurance-platform-db-1 bash     # Database container shell
```

---

## Database Commands (run on VPS)

### Open database prompt
```bash
docker exec -it insurance-platform-db-1 psql -U insurance_user -d insurance_platform
```

### Inside the database prompt (psql)
```sql
-- List all tables
\dt

-- Show table structure
\d users
\d clients
\d policies

-- Count rows
SELECT COUNT(*) FROM users;
SELECT COUNT(*) FROM clients;
SELECT COUNT(*) FROM policies;

-- View users
SELECT id, email, user_type, is_active FROM users;

-- Reset a user's password
-- First enable pgcrypto if not done:
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- Then update:
UPDATE users SET password_hash = crypt('NewPassword123', gen_salt('bf', 10))
WHERE email = 'someone@example.com';

-- Exit database prompt
\q
```

### Run a quick SQL command without entering the prompt
```bash
docker exec -it insurance-platform-db-1 psql -U insurance_user -d insurance_platform -c "SELECT id, email FROM users;"
```

---

## Database Backup & Restore

### Backup production database (run on VPS)
```bash
docker exec insurance-platform-db-1 pg_dump -U insurance_user -d insurance_platform > /root/backup_$(date +%Y%m%d).sql
```

### Download backup to your PC (run on your PC)
```bash
scp root@31.97.187.61:/root/backup_20260313.sql ./backup.sql
```

### Backup local database (run on your PC)
```bash
docker exec insurance_postgres pg_dump -U insurance_admin -d insurance_platform --clean --if-exists > db_dump.sql
```

### Upload & import local data to VPS
```bash
# On your PC - upload
scp db_dump.sql root@31.97.187.61:/root/db_dump.sql

# On VPS - import
docker cp /root/db_dump.sql insurance-platform-db-1:/tmp/db_dump.sql
docker exec -it insurance-platform-db-1 psql -U insurance_user -d insurance_platform -f /tmp/db_dump.sql
```

---

## File Transfer (SCP)

```bash
# Upload file to VPS (run from your PC)
scp localfile.txt root@31.97.187.61:/root/remotefile.txt

# Download file from VPS (run from your PC)
scp root@31.97.187.61:/root/remotefile.txt ./localfile.txt

# Upload a folder
scp -r ./myfolder root@31.97.187.61:/root/myfolder
```

---

## Nginx (Web Server / Reverse Proxy)

```bash
# Test config for errors
nginx -t

# Restart Nginx
systemctl restart nginx

# View Nginx status
systemctl status nginx

# View Nginx error logs
tail -50 /var/log/nginx/error.log

# Edit site config
nano /etc/nginx/sites-available/bravogi
```

---

## SSL Certificate (Let's Encrypt)

```bash
# Check certificate status
certbot certificates

# Renew certificates (auto-renews, but manual if needed)
certbot renew

# Get new certificate
certbot --nginx -d bravogi.com -d www.bravogi.com
```

---

## Firewall (UFW)

```bash
ufw status              # Show current rules
ufw allow 80            # Allow HTTP
ufw allow 443           # Allow HTTPS
ufw allow 22            # Allow SSH
ufw allow 3000          # Allow port 3000
ufw deny 3000           # Block port 3000
ufw enable              # Turn on firewall
ufw disable             # Turn off firewall
```

---

## Linux Basics (on VPS)

```bash
# Navigation
pwd                     # Print current directory
ls                      # List files
ls -la                  # List all files with details
cd /root                # Go to home directory
cd ..                   # Go up one directory

# File operations
cat file.txt            # View file contents
nano file.txt           # Edit file (Ctrl+O save, Ctrl+X exit)
cp file.txt backup.txt  # Copy file
mv old.txt new.txt      # Rename/move file
rm file.txt             # Delete file
mkdir myfolder          # Create directory

# System
df -h                   # Disk usage
free -h                 # Memory usage
top                     # Running processes (q to quit)
htop                    # Better process viewer (if installed)

# Process management
ps aux                  # List all processes
kill 1234               # Kill process by PID

# Package management (Ubuntu)
apt update              # Update package list
apt upgrade -y          # Upgrade all packages
apt install htop -y     # Install a package

# User management
passwd                  # Change current user's password
```

---

## Important Paths

| What | Path |
|------|------|
| Nginx site config | `/etc/nginx/sites-available/bravogi` |
| Nginx logs | `/var/log/nginx/` |
| SSL certificates | `/etc/letsencrypt/live/bravogi.com/` |
| App code (if cloned) | `/root/insurance-platform/` |
| DB dump location | `/root/` |

---

## Portainer (Docker Web UI)

- URL: `https://31.97.187.61:9443`
- Use for: deploying stacks, viewing containers, checking logs
- To redeploy after code changes: Stacks → insurance-platform → "Pull and redeploy"

---

## Quick Troubleshooting

| Problem | Check |
|---------|-------|
| Site shows 502 | `docker ps -a` (is app running?) → `docker logs insurance-platform-app-1` |
| Site not loading | `ufw status` (port open?) → `systemctl status nginx` |
| Can't log in | Check user exists: `docker exec -it insurance-platform-db-1 psql -U insurance_user -d insurance_platform -c "SELECT email FROM users;"` |
| SSL expired | `certbot renew` |
| Disk full | `df -h` → `docker system prune` (removes old images) |
