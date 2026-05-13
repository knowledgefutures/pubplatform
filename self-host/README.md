# Self-host documentation

For the most part, self-hosting PubPub is a matter of deploying the app and the database, which you can do with the accompanying docker-compose file in `self-host/docker-compose.yml`.

However, there are a few key things you need to know about.

## Quick start

### Clone the repo

First, you need to clone this repo.

You can either clone the entire repo by doing

```sh
git clone https://github.com/pubpub/platform.git pubpub-platform
cd pubpub-platform/self-host
```

or you can clone just the `self-host` directory by doing

```sh
git clone -n --depth=1 --filter=tree:0 \
         https://github.com/pubpub/platform
cd platform
git sparse-checkout set --no-cone /self-host
git checkout
cd ..
mv platform/self-host pubpub-platform
rm -rf platform
cd pubpub-platform
```

Either way you will now be inside of a directory with an `.env.example` file and a `docker-compose.yml` file. Success!

### Set up the environment variables

The `.env.example` file will give you a list of environment variables you need to set.

You need to copy the `.env.example` file to a new file called `.env` and then fill in the values.

```sh
cp .env.example .env
```

Now you will need to setup some environment variables.

#### Database

> [!WARNING]
> It's important you set up different values for this before initializing the database for the first time
> as it's annoying to change later

You need to set your own postgres user, password, and database name. The defaults are not safe. These defaults will be used to spin up a postgres database in a container.

In case you want to use a remote postgres database, you can set the `POSTGRES_HOST` to the domain of the database you want to use.

To generate a strong password, you can use one of these commands:

```sh
# On Linux/macOS:
openssl rand -base64 32

# Alternative using /dev/urandom:
< /dev/urandom tr -dc A-Za-z0-9 | head -c32; echo

# On Windows PowerShell:
[System.Web.Security.Membership]::GeneratePassword(32,8)
```

Use the output of one of these commands as the password for your postgres user.

```sh
POSTGRES_USER=my-postgres-user # change this!
POSTGRES_PASSWORD= # change this to the output of one of the commands above!
POSTGRES_DB=my-postgres-db # change this! this is hard to change after the database has been created
POSTGRES_HOST=db # change this to the name of the service in docker-compose.yml, or the domain of a remote postgres database if you're using that instead
```

#### Files

> [!WARNING]
> It's important you set up different values for this immediately

The hosted version of Platfrom uses AWS S3 to host files. When self-hosting, you have two options:

1. Provide your own S3/S3-compatible storage service credentials
2. Use the built-in MinIO service, which emulates S3 locally.

### Using your own S3-compatible storage service

If you want to use your own S3-compatible storage service, you will need to set the following environment variables:

```sh
S3_BUCKET_NAME="your-bucket-name"
S3_ACCESS_KEY="your-access-key"
S3_SECRET_KEY="your-secret-key"
S3_REGION="your-region"
S3_ENDPOINT="your-storage-endpoint" # only necessary if you are using non-AWS S3-compatible storage service
```

You should also remove the `minio` and `minio-init` services from the `docker-compose.yml` file.

### Using the built-in MinIO service

If you want to use the built-in MinIO service, you will need to set the following environment variables:

You will need two strong passwords for your file server:

- One for the root user
- One for the user we create that can only upload files

To generate a strong password, you can use one of these commands:

```sh
# On Linux/macOS:
openssl rand -base64 32

# Alternative using /dev/urandom:
< /dev/urandom tr -dc A-Za-z0-9 | head -c32; echo

# On Windows PowerShell:
[System.Web.Security.Membership]::GeneratePassword(32,8)
```

Run one of these commands twice, and use one for `MINIO_ROOT_PASSWORD` and one for `S3_SECRET_KEY`.

```sh
# not needed if you're using a remote file server like AWS S3
MINIO_ROOT_USER= # change this! this is the username for your file server!
MINIO_ROOT_PASSWORD= # change this! this is the password for your file server!

# these are either the values of an existing S3-compatible storage service, or the values that will be used to create a new MinIO service
S3_BUCKET_NAME= # example: assets
S3_ACCESS_KEY= # example: asset-user
S3_SECRET_KEY= # example: a strong secure password
S3_REGION=us-east-1 # leave this unchanged, unless you are hosting files on a different region on actual AWS
```

Then, after running `docker compose up -d`, you should be able to visit the MinIO console at `http://localhost:9001`.

#### SSL/Caddy

> [!NOTE]
> Disabled by default, see later section for more information

#### Email

> [!NOTE]
> Can be set up later, or not at all

To be able to send emails, you need to set some kind of email provider.

We recommend using [Mailgun](https://www.mailgun.com/).

Other common options are [SendGrid](https://sendgrid.com/) and [Postmark](https://postmarkapp.com/).

You can also use an existing GMail or Office365 account to relay emails through PubPub.
Other providers may likely work as well, but are not tested.

##### Mailgun

To use Mailgun, you will need to create an account on [Mailgun](https://www.mailgun.com/) and set the following environment variables:

```sh
SMTP_HOST="smtp.mailgun.org"
SMTP_PORT=587
SMTP_USERNAME="postmaster@your-mailgun-domain.mailgun.org"
SMTP_PASSWORD="your-mailgun-password"
SMTP_FROM="email@your-mailgun-domain.mailgun.org"
SMTP_FROM_NAME="Your Organization"
```

##### Gmail

To use Gmail to relay emails through PubPub, you will need to create an [app password](https://support.google.com/accounts/answer/185833?hl=en).

You will be limited to 2000 emails per day by default this way.

```sh
SMTP_HOST="smtp.gmail.com"
SMTP_PORT=587 # or 465 for SSL
SMTP_USERNAME="email@gmail.com"
SMTP_PASSWORD="your app password" # this will be a 16 character string
SMTP_FROM="email@gmail.com" # technically optional, but you will almost definitely need to set this.
SMTP_FROM_NAME="Your Organization" # Optional, will default to "PubPub Team"
```

If you need a higher limit of 10,000 emails, you can use the SMTP relay service. This will require extra configuration however:
https://support.google.com/a/answer/176600?hl=en

```sh
SMTP_HOST="smtp-relay.gmail.com"
SMTP_PORT=587 # or 465 for SSL
SMTP_USERNAME="email@gmail.com"
SMTP_PASSWORD="your app password" # this will be a 16 character string
SMTP_FROM="email@gmail.com" # technically optional, but you will almost definitely need to set this.
SMTP_FROM_NAME="Your Organization" # Optional, will default to "PubPub Team"
```

##### Office 365

You can (for now) send emails through Office 365 Outlook/Exchange through SMTP, although Microsoft has repeatedly stated they will likely deprecate this feature in the future.

You cannot send emails through shared mailboxes, you will need to an existing Microsoft account with a valid Office 365 subscription.

```sh
SMTP_HOST="smtp.office365.com"
SMTP_PORT=587
SMTP_USERNAME="email@outlook.com"
SMTP_PASSWORD="your-password"
SMTP_FROM="email@outlook.com" # technically optional, but you will almost definitely need to set this, as it will use `hello@pubpub.org` by default.
SMTP_FROM_NAME="Your Organization" # Optional, will default to "PubPub Team"
```

##### No email

You can technically leave the email provider blank, but this will disable the email functionality. The email action will still be visible in the UI, but it will fail when you try to send an email.

#### Other

...

### Disable services you don't want or need

By default, a number of services are enabled in `docker-compose.yml` that you may not want or need.

Here a short list of the built in services:

#### Postgres Database

By default, we will spin up a postgres database in a container.

You may want to use your own postgres database instead, in which case you can disable this by removing the `db` service from the `docker-compose.yml` file, and removing the

```yml
db:
  condition: service_started
```

from the `depends_on` section of the `platform` service.

```yml
platform:
  depends_on:
    db:
      condition: service_started
```

#### MinIO

By default, we will spin up a MinIO container to host files locally.

You can choose to instead choose to use any other S3-compatible storage service, in which case you can disable this by removing the `minio` and `minio-init` services from the `docker-compose.yml` file.

Be sure to follow the instructions above for configuring the environment variables for your S3-compatible storage service.

### Start the services for the first time

Now you should be ready to start the services for the first time!

```sh
docker compose up -d
```

Everything should start up without any issues.

You should now be able to visit Platform at `http://localhost:3000`, and browse your files at `http://localhost:9001` (if you are using the built-in MinIO service).

### Complete the initial setup

When you first visit Platform at `http://localhost:3000`, you'll see a setup screen where you can create the first admin user and your first community in a single step.

Fill in the form with:

- Your admin account details (email, password, first name, last name)
- Your first community details (name, slug, and optionally an avatar URL)

Once you submit the form, you'll be automatically logged in and redirected to your new community dashboard.

### Create additional communities

As a super admin, you can create additional communities by navigating to `http://localhost:3000/communities`.

Congrats! You're ready to start using Platform!
