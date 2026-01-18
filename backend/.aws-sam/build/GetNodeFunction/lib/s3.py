"""S3 helper utilities for file operations."""

import os
from typing import Dict, List, Optional

import boto3
from botocore.exceptions import ClientError

from .response import internal_error_response

s3_client = boto3.client("s3", region_name=os.environ.get("AWS_REGION", "us-east-1"))
bucket_name = os.environ["FILES_BUCKET"]

# Presigned URL expiration (1 hour)
PRESIGNED_URL_EXPIRATION = 3600


def generate_presigned_put_url(
    s3_key: str,
    content_type: str,
    expires_in: int = PRESIGNED_URL_EXPIRATION,
) -> Optional[str]:
    """
    Generate a presigned PUT URL for uploading a file.
    
    Returns:
        Presigned URL string or None on error
    """
    try:
        url = s3_client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": bucket_name,
                "Key": s3_key,
                "ContentType": content_type,
            },
            ExpiresIn=expires_in,
        )
        return url
    except ClientError:
        return None


def generate_presigned_get_url(
    s3_key: str,
    expires_in: int = PRESIGNED_URL_EXPIRATION,
) -> Optional[str]:
    """
    Generate a presigned GET URL for downloading/viewing a file.
    
    Returns:
        Presigned URL string or None on error
    """
    try:
        url = s3_client.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": bucket_name,
                "Key": s3_key,
            },
            ExpiresIn=expires_in,
        )
        return url
    except ClientError:
        return None


def extract_file_s3_keys_from_nodes(nodes: List[Dict]) -> List[str]:
    """
    Extract all S3 keys from file references in nodes' inputs, outputs, and evidence.
    
    Returns list of S3 keys for files where type="file".
    """
    s3_keys = []
    for node in nodes:
        # Check inputs
        for item in node.get("inputs", []):
            if item.get("type") == "file" and item.get("s3Key"):
                s3_keys.append(item["s3Key"])
        
        # Check outputs
        for item in node.get("outputs", []):
            if item.get("type") == "file" and item.get("s3Key"):
                s3_keys.append(item["s3Key"])

        # Check evidence files
        evidence = node.get("evidence", [])
        evidence_items = []
        if isinstance(evidence, list):
            evidence_items = evidence
        elif isinstance(evidence, dict):
            evidence_items = evidence.get("files", [])
        for item in evidence_items:
            if item.get("type") == "file" and item.get("s3Key"):
                s3_keys.append(item["s3Key"])
    
    return s3_keys


def batch_delete_s3_objects(s3_keys: List[str]) -> int:
    """
    Delete multiple S3 objects in batches.
    S3 delete_objects can handle up to 1000 objects per request.
    
    Returns number of successfully deleted objects.
    """
    if not s3_keys:
        return 0
    
    deleted_count = 0
    
    # Process in batches of 1000
    for i in range(0, len(s3_keys), 1000):
        batch = s3_keys[i:i + 1000]
        delete_objects = [{"Key": key} for key in batch]
        
        try:
            response = s3_client.delete_objects(
                Bucket=bucket_name,
                Delete={
                    "Objects": delete_objects,
                    "Quiet": True,
                },
            )
            # Count successful deletions (no Errors in response)
            errors = response.get("Errors", [])
            deleted_count += len(batch) - len(errors)
        except ClientError:
            # Continue even if some fail
            pass
    
    return deleted_count
