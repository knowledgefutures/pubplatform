/usr/bin/mc alias set myminio http://minio:9000 "${MINIO_ROOT_USER}" "${MINIO_ROOT_PASSWORD}";
/usr/bin/mc mb --ignore-existing myminio/"${S3_BUCKET_NAME}";
/usr/bin/mc anonymous set download myminio/"${S3_BUCKET_NAME}";
/usr/bin/mc admin user add myminio "${S3_ACCESS_KEY}" "${S3_SECRET_KEY}";
/usr/bin/mc admin policy attach myminio readwrite --user "${S3_ACCESS_KEY}";

if [ -n "${S3_BACKUP_BUCKET}" ] && [ -n "${S3_BACKUP_ACCESS_KEY}" ] && [ -n "${S3_BACKUP_SECRET_KEY}" ]; then
    /usr/bin/mc mb --ignore-existing myminio/"${S3_BACKUP_BUCKET}";
    /usr/bin/mc anonymous set none myminio/"${S3_BACKUP_BUCKET}";
    /usr/bin/mc admin user add myminio "${S3_BACKUP_ACCESS_KEY}" "${S3_BACKUP_SECRET_KEY}";
    /usr/bin/mc admin policy attach myminio readwrite --user "${S3_BACKUP_ACCESS_KEY}";
fi