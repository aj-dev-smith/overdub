-- Athena database, table and view over CloudFront's standard (legacy) access logs for overdub.ajsmithhq.com.
-- deploy/analytics/setup.sh runs these statements one at a time with __LOGS__ replaced by s3://overdub-logs-<account>.
-- The columns are CloudFront's standard log format (33 fields, tab separated, two header lines per file).
-- Counts are the GETs of /app/e.gif and /site/e.gif sent by app/src/analytics.js and site/assets/analytics.js.

CREATE DATABASE IF NOT EXISTS overdub;

CREATE EXTERNAL TABLE IF NOT EXISTS overdub.cf_logs (
  `date` DATE, time STRING, location STRING, bytes BIGINT, request_ip STRING, method STRING, host STRING, uri STRING,
  status INT, referrer STRING, user_agent STRING, query_string STRING, cookie STRING, result_type STRING,
  request_id STRING, host_header STRING, request_protocol STRING, request_bytes BIGINT, time_taken FLOAT,
  xforwarded_for STRING, ssl_protocol STRING, ssl_cipher STRING, response_result_type STRING, http_version STRING,
  fle_status STRING, fle_encrypted_fields INT, c_port INT, time_to_first_byte FLOAT, x_edge_detailed_result_type STRING,
  sc_content_type STRING, sc_content_len BIGINT, sc_range_start BIGINT, sc_range_end BIGINT)
ROW FORMAT DELIMITED FIELDS TERMINATED BY '\t'
LOCATION '__LOGS__/cf-logs/'
TBLPROPERTIES ('skip.header.line.count'='2');

-- One row per count: the day, the event, its one enumerated field and the referring host (views and opens only).
-- Deliberately leaves out the address, the browser and everything else in the log line.
CREATE OR REPLACE VIEW overdub.events AS
SELECT "date",
  url_extract_parameter('x?' || query_string, 'e') AS e,
  coalesce(url_extract_parameter('x?' || query_string, 'p'), '') AS p,
  coalesce(url_extract_parameter('x?' || query_string, 'r'), '') AS r
FROM overdub.cf_logs
WHERE uri IN ('/app/e.gif', '/site/e.gif') AND method = 'GET' AND query_string <> '-';
