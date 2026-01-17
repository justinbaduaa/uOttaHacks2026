"""Simple test script to run Lambda functions locally."""

import json
import sys
import os

# Add src to path so we can import handlers
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))

from handlers.canvases import create_canvas, join_canvas, list_canvases


def create_mock_event(body=None, query_params=None, path_params=None, user_sub="test-user-123"):
    """Create a mock API Gateway event with JWT auth."""
    event = {
        "version": "2.0",
        "routeKey": "POST /canvases",
        "rawPath": "/canvases",
        "rawQueryString": "",
        "headers": {},
        "requestContext": {
            "http": {
                "method": "POST",
                "path": "/canvases",
            },
            "authorizer": {
                "jwt": {
                    "claims": {
                        "sub": user_sub,
                        "email": "test@example.com"
                    }
                }
            }
        }
    }
    
    if body:
        event["body"] = json.dumps(body) if isinstance(body, dict) else body
    
    if query_params:
        event["queryStringParameters"] = query_params
    
    if path_params:
        event["pathParameters"] = path_params
    
    return event


def create_mock_context():
    """Create a mock Lambda context."""
    class MockContext:
        function_name = "test-function"
        function_version = "1"
        invoked_function_arn = "arn:aws:lambda:us-east-1:123456789012:function:test-function"
        memory_limit_in_mb = "512"
        aws_request_id = "test-request-id"
    
    return MockContext()


def test_create_canvas():
    """Test create_canvas function."""
    print("=" * 50)
    print("Testing create_canvas()")
    print("=" * 50)
    
    event = create_mock_event(body={"name": "Test Canvas"})
    context = create_mock_context()
    
    # Set required environment variables (use dummy values for local testing)
    os.environ.setdefault("CANVAS_TABLE", "GlassBoxCanvasTable")
    os.environ.setdefault("NODES_TABLE", "GlassBoxNodesTable")
    os.environ.setdefault("FILES_BUCKET", "test-bucket")
    os.environ.setdefault("USER_POOL_ID", "test-pool")
    os.environ.setdefault("AWS_REGION", "us-east-1")
    
    try:
        result = create_canvas(event, context)
        print("\nResponse:")
        print(json.dumps(result, indent=2))
        
        # Parse body if it's a string
        if isinstance(result.get("body"), str):
            body = json.loads(result["body"])
            print(f"\nStatus: {result['statusCode']}")
            print(f"Success: {body.get('ok')}")
            if body.get("data"):
                print(f"Data: {json.dumps(body['data'], indent=2)}")
            if body.get("error"):
                print(f"Error: {json.dumps(body['error'], indent=2)}")
    except Exception as e:
        print(f"\nError: {str(e)}")
        import traceback
        traceback.print_exc()


def test_list_canvases():
    """Test list_canvases function."""
    print("\n" + "=" * 50)
    print("Testing list_canvases()")
    print("=" * 50)
    
    event = create_mock_event(query_params={})
    context = create_mock_context()
    
    os.environ.setdefault("CANVAS_TABLE", "GlassBoxCanvasTable")
    os.environ.setdefault("AWS_REGION", "us-east-1")
    
    try:
        result = list_canvases(event, context)
        print("\nResponse:")
        print(json.dumps(result, indent=2))
    except Exception as e:
        print(f"\nError: {str(e)}")
        import traceback
        traceback.print_exc()


def test_join_canvas():
    """Test join_canvas function."""
    print("\n" + "=" * 50)
    print("Testing join_canvas()")
    print("=" * 50)
    
    event = create_mock_event(body={"joinCode": "TEST1234"})
    context = create_mock_context()
    
    os.environ.setdefault("CANVAS_TABLE", "GlassBoxCanvasTable")
    os.environ.setdefault("AWS_REGION", "us-east-1")
    
    try:
        result = join_canvas(event, context)
        print("\nResponse:")
        print(json.dumps(result, indent=2))
    except Exception as e:
        print(f"\nError: {str(e)}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    print("Lambda Function Test Runner")
    print("\nNote: This requires AWS credentials and DynamoDB tables to be set up.")
    print("Environment variables can be set in your shell or .env file.\n")
    
    # Run all tests or specific one
    if len(sys.argv) > 1:
        test_name = sys.argv[1]
        if test_name == "create":
            test_create_canvas()
        elif test_name == "list":
            test_list_canvases()
        elif test_name == "join":
            test_join_canvas()
        else:
            print(f"Unknown test: {test_name}")
            print("Available tests: create, list, join")
    else:
        # Run all tests
        test_create_canvas()
        test_list_canvases()
        test_join_canvas()
